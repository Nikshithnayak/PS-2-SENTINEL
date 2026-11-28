import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { decryptPhi, encryptPhi } from '@sentinel/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { appendAuditLog, withSystemDb } from '@/db';
import { account } from '@/db/schema';

export type GoogleHealthMode = 'google_fit' | 'google_health_api';

export const GOOGLE_FIT_SCOPES = [
  'https://www.googleapis.com/auth/fitness.heart_rate.read',
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.oxygen_saturation.read',
  'https://www.googleapis.com/auth/fitness.sleep.read',
  'https://www.googleapis.com/auth/fitness.body_temperature.read',
  'https://www.googleapis.com/auth/fitness.blood_pressure.read',
  'https://www.googleapis.com/auth/fitness.blood_glucose.read',
] as const;

export const GOOGLE_HEALTH_V4_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
] as const;

export interface GoogleConnectorOAuthConfig {
  configured: boolean;
  clientId: string | null;
  clientSecret: string | null;
  callbackUrl: string;
  origin: string;
}

export interface GoogleConnectorConnectionStatus {
  mode: GoogleHealthMode;
  connected: boolean;
  needsReconnect?: boolean;
  scope: string | null;
  hasRefreshToken: boolean;
  expiresAt: string | null;
  updatedAt: string | null;
}

function getEncryptionKey(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.PHI_ENCRYPTION_KEY?.trim() ||
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
  );
}

/**
 * Resolves the canonical request origin behind Vercel / local proxies without mixing up
 * `localhost` vs `127.0.0.1` or `https` vs `http`.
 */
export function resolveRequestOrigin(
  request: NextRequest,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fwdHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = fwdHost || request.headers.get('host')?.trim();
  const fwdProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (host) {
    const proto = fwdProto || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
    return `${proto}://${host}`;
  }
  const configured =
    env.NEXT_PUBLIC_APP_URL?.trim() ||
    env.BETTER_AUTH_URL?.trim() ||
    (env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
      ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`
      : '');
  return (configured || request.nextUrl.origin || 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * Resolves OAuth 2.0 client credentials for Google Health / Google Fit direct sync.
 * Prefers dedicated `GOOGLE_HEALTH_CLIENT_ID/SECRET` when set and falls back cleanly
 * to the workspace `GOOGLE_CLIENT_ID/SECRET`.
 */
export function resolveGoogleConnectorOAuthConfig(
  mode: GoogleHealthMode,
  origin: string,
  env: NodeJS.ProcessEnv = process.env,
): GoogleConnectorOAuthConfig {
  const dedicatedId = env.GOOGLE_HEALTH_CLIENT_ID?.trim() || null;
  const dedicatedSecret = env.GOOGLE_HEALTH_CLIENT_SECRET?.trim() || null;
  const appId = env.GOOGLE_CLIENT_ID?.trim() || env.AUTH_GOOGLE_ID?.trim() || null;
  const appSecret = env.GOOGLE_CLIENT_SECRET?.trim() || env.AUTH_GOOGLE_SECRET?.trim() || null;

  const useDedicated = mode === 'google_health_api' && dedicatedId && dedicatedSecret;
  const clientId = useDedicated ? dedicatedId : appId;
  const clientSecret = useDedicated ? dedicatedSecret : appSecret;

  const explicitRedirect =
    env.GOOGLE_CONNECTOR_REDIRECT_URI?.trim() ||
    env.GOOGLE_FIT_REDIRECT_URI?.trim() ||
    null;
  const normalizedOrigin = origin.replace(/\/$/, '');
  return {
    configured: Boolean(clientId && clientSecret),
    clientId,
    clientSecret,
    origin: normalizedOrigin,
    callbackUrl: explicitRedirect || `${normalizedOrigin}/api/auth/callback/google`,
  };
}

export function buildGoogleConnectorAuthUrl(params: {
  mode: GoogleHealthMode;
  clientId: string;
  callbackUrl: string;
  state: string;
  loginHint?: string;
}): string {
  const scopes =
    params.mode === 'google_health_api' ? GOOGLE_HEALTH_V4_SCOPES : GOOGLE_FIT_SCOPES;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', params.clientId);
  authUrl.searchParams.set('redirect_uri', params.callbackUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scopes.join(' '));
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set('state', params.state);
  if (params.loginHint) {
    authUrl.searchParams.set('login_hint', params.loginHint);
  }
  return authUrl.toString();
}

export async function saveEncryptedGoogleConnectorTokens(params: {
  userId: string;
  mode: GoogleHealthMode;
  accessToken: string;
  refreshToken?: string | null;
  expiresInSeconds?: number | null;
  scope?: string | null;
}): Promise<void> {
  const phiKey = getEncryptionKey();
  const encAccess = encryptPhi(params.accessToken, phiKey);
  const encRefresh = params.refreshToken ? encryptPhi(params.refreshToken, phiKey) : null;
  const expiresAt =
    typeof params.expiresInSeconds === 'number' && params.expiresInSeconds > 0
      ? new Date(Date.now() + params.expiresInSeconds * 1000)
      : new Date(Date.now() + 3500 * 1000);
  const accountKey = `${params.mode}:${params.userId}`;
  const now = new Date();

  await withSystemDb(async (tx) => {
    const existing = await tx
      .select()
      .from(account)
      .where(and(eq(account.userId, params.userId), eq(account.providerId, params.mode)))
      .limit(1);

    if (existing[0]) {
      await tx
        .update(account)
        .set({
          accessToken: encAccess,
          refreshToken: encRefresh ?? existing[0].refreshToken,
          accessTokenExpiresAt: expiresAt,
          scope: params.scope ?? existing[0].scope,
          updatedAt: now,
        })
        .where(eq(account.id, existing[0].id));
    } else {
      await tx.insert(account).values({
        id: randomUUID(),
        accountId: accountKey,
        providerId: params.mode,
        userId: params.userId,
        accessToken: encAccess,
        refreshToken: encRefresh,
        accessTokenExpiresAt: expiresAt,
        scope: params.scope ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }

    await appendAuditLog(tx, {
      actorUserId: params.userId,
      action: `connector.${params.mode}.connected`,
      targetType: 'wearable_connector',
      targetId: accountKey,
      payload: {
        mode: params.mode,
        hasRefreshToken: Boolean(encRefresh),
        scope: params.scope ?? null,
      },
    });
  });
}

export async function getValidGoogleConnectorToken(params: {
  userId: string;
  mode: GoogleHealthMode;
  origin: string;
}): Promise<{ accessToken: string; scope: string | null } | null> {
  const row = await withSystemDb((tx) =>
    tx
      .select()
      .from(account)
      .where(and(eq(account.userId, params.userId), eq(account.providerId, params.mode)))
      .limit(1),
  );
  const record = row[0];
  if (!record?.accessToken) return null;

  const phiKey = getEncryptionKey();
  let accessToken: string;
  let refreshToken: string | null = null;
  try {
    accessToken = decryptPhi(record.accessToken, phiKey);
    if (record.refreshToken) {
      refreshToken = decryptPhi(record.refreshToken, phiKey);
    }
  } catch {
    return null;
  }

  const expiresMs = record.accessTokenExpiresAt?.getTime() ?? 0;
  const stillFresh = expiresMs === 0 || expiresMs > Date.now() + 60_000;
  if (stillFresh) {
    return { accessToken, scope: record.scope ?? null };
  }

  if (!refreshToken) {
    return null;
  }

  const oauthCfg = resolveGoogleConnectorOAuthConfig(params.mode, params.origin);
  if (!oauthCfg.configured || !oauthCfg.clientId || !oauthCfg.clientSecret) {
    return null;
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: oauthCfg.clientId,
      client_secret: oauthCfg.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
    signal: AbortSignal.timeout(8000),
  });
  if (!tokenRes.ok) {
    return null;
  }

  const refreshed = (await tokenRes.json()) as {
    access_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!refreshed.access_token) return null;

  await saveEncryptedGoogleConnectorTokens({
    userId: params.userId,
    mode: params.mode,
    accessToken: refreshed.access_token,
    refreshToken,
    expiresInSeconds: refreshed.expires_in ?? 3600,
    scope: refreshed.scope ?? record.scope ?? null,
  });

  return {
    accessToken: refreshed.access_token,
    scope: refreshed.scope ?? record.scope ?? null,
  };
}

export async function getGoogleConnectorsStatus(
  userId: string,
  origin: string,
): Promise<{
  oauthClientConfigured: boolean;
  callbackUrl: string;
  connections: Record<GoogleHealthMode, GoogleConnectorConnectionStatus>;
}> {
  const oauthCfg = resolveGoogleConnectorOAuthConfig('google_fit', origin);
  const rows = await withSystemDb((tx) =>
    tx
      .select({
        providerId: account.providerId,
        scope: account.scope,
        refreshToken: account.refreshToken,
        accessTokenExpiresAt: account.accessTokenExpiresAt,
        updatedAt: account.updatedAt,
      })
      .from(account)
      .where(
        and(
          eq(account.userId, userId),
          inArray(account.providerId, ['google_fit', 'google_health_api']),
        ),
      ),
  );

  const byProvider = new Map(rows.map((r) => [r.providerId, r]));
  const mapRow = (mode: GoogleHealthMode): GoogleConnectorConnectionStatus => {
    const r = byProvider.get(mode);
    const expiresMs = r?.accessTokenExpiresAt?.getTime() ?? 0;
    const expiredWithoutRefresh = Boolean(r && expiresMs > 0 && expiresMs <= Date.now() && !r.refreshToken);
    return {
      mode,
      connected: Boolean(r) && !expiredWithoutRefresh,
      needsReconnect: expiredWithoutRefresh,
      scope: r?.scope ?? null,
      hasRefreshToken: Boolean(r?.refreshToken),
      expiresAt: r?.accessTokenExpiresAt?.toISOString() ?? null,
      updatedAt: r?.updatedAt?.toISOString() ?? null,
    };
  };

  return {
    oauthClientConfigured: oauthCfg.configured,
    callbackUrl: oauthCfg.callbackUrl,
    connections: {
      google_fit: mapRow('google_fit'),
      google_health_api: mapRow('google_health_api'),
    },
  };
}

export async function disconnectGoogleConnector(
  userId: string,
  mode: GoogleHealthMode,
): Promise<void> {
  await withSystemDb(async (tx) => {
    await tx
      .delete(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, mode)));

    await appendAuditLog(tx, {
      actorUserId: userId,
      action: `connector.${mode}.disconnected`,
      targetType: 'wearable_connector',
      targetId: `${mode}:${userId}`,
      payload: { mode },
    });
  });
}
