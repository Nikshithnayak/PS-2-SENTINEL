import { NextResponse, type NextRequest } from 'next/server';
import { maybeTriggerAlertFromEvaluation } from '@/lib/alerts/outbox';
import { runAndPersistEvaluation } from '@/lib/engine/client';
import { GoogleFitAdapter, GoogleHealthAdapter } from '@/lib/ingestion/adapters/providers';
import {
  resolveGoogleConnectorOAuthConfig,
  resolveRequestOrigin,
  saveEncryptedGoogleConnectorTokens,
  type GoogleHealthMode,
} from '@/lib/ingestion/connectors/google-cloud-health';
import { ingestVitalBatch } from '@/lib/ingestion/quality';
import { checkPatientScope, getSessionContext } from '@/lib/session';

const CONNECTOR_STATE_COOKIE = 'sentinel_gconn_state';

interface ConnectorStateCookie {
  state: string;
  userId: string;
  patientId: string;
  mode: GoogleHealthMode;
  origin: string;
}

function redirectWithClear(url: string) {
  const res = NextResponse.redirect(url);
  res.cookies.delete(CONNECTOR_STATE_COOKIE);
  return res;
}

export async function GET(request: NextRequest) {
  const fallbackOrigin = resolveRequestOrigin(request);
  const rawCookie = request.cookies.get(CONNECTOR_STATE_COOKIE)?.value;
  let parsedCookie: ConnectorStateCookie | null = null;
  if (rawCookie) {
    try {
      parsedCookie = JSON.parse(rawCookie) as ConnectorStateCookie;
    } catch {
      parsedCookie = null;
    }
  }

  const origin = parsedCookie?.origin || fallbackOrigin;
  const ctx = await getSessionContext();
  if (!ctx) {
    return redirectWithClear(`${origin}/auth?next=/ingest`);
  }

  const oauthError = request.nextUrl.searchParams.get('error');
  const oauthErrorDesc = request.nextUrl.searchParams.get('error_description');
  if (oauthError) {
    return redirectWithClear(
      `${origin}/ingest?connector_error=${encodeURIComponent(oauthErrorDesc || `Google authorization stopped: ${oauthError}`)}`,
    );
  }

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  if (
    !code ||
    !state ||
    !parsedCookie ||
    parsedCookie.state !== state ||
    parsedCookie.userId !== ctx.userId
  ) {
    return redirectWithClear(
      `${origin}/ingest?connector_error=${encodeURIComponent('Google OAuth verification failed or expired. Please click Connect again.')}`,
    );
  }

  const allowed = await checkPatientScope(ctx, parsedCookie.patientId, 'vitals_read');
  if (!allowed) {
    return redirectWithClear(
      `${origin}/ingest?connector_error=${encodeURIComponent('Forbidden patient scope.')}`,
    );
  }

  const oauthCfg = resolveGoogleConnectorOAuthConfig(parsedCookie.mode, origin);
  if (!oauthCfg.configured || !oauthCfg.clientId || !oauthCfg.clientSecret) {
    return redirectWithClear(
      `${origin}/ingest?connector_error=${encodeURIComponent('Missing Google OAuth credentials on server.')}`,
    );
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: oauthCfg.clientId,
      client_secret: oauthCfg.clientSecret,
      redirect_uri: oauthCfg.callbackUrl,
      grant_type: 'authorization_code',
    }).toString(),
    signal: AbortSignal.timeout(10000),
  });

  if (!tokenRes.ok) {
    const errJson = (await tokenRes.json().catch(() => ({}))) as {
      error_description?: string;
      error?: string;
    };
    return redirectWithClear(
      `${origin}/ingest?connector_error=${encodeURIComponent(errJson.error_description || errJson.error || `Google token exchange failed (${tokenRes.status}).`)}`,
    );
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!tokenData.access_token) {
    return redirectWithClear(
      `${origin}/ingest?connector_error=${encodeURIComponent('Google did not return an access token.')}`,
    );
  }

  await saveEncryptedGoogleConnectorTokens({
    userId: ctx.userId,
    mode: parsedCookie.mode,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token ?? null,
    expiresInSeconds: tokenData.expires_in ?? 3600,
    scope: tokenData.scope ?? null,
  });

  // Immediately pull last 48h of vitals cleanly after connecting
  const endIso = new Date().toISOString();
  const startIso = new Date(Date.now() - 48 * 3600_000).toISOString();
  const adapter =
    parsedCookie.mode === 'google_health_api'
      ? new GoogleHealthAdapter()
      : new GoogleFitAdapter();

  try {
    const samples = await adapter.fetchRecentSamples({
      externalUserId: parsedCookie.patientId,
      startIso,
      endIso,
      accessToken: tokenData.access_token,
    });

    if (samples.length === 0) {
      return redirectWithClear(
        `${origin}/ingest?connector=${parsedCookie.mode}&synced=0`,
      );
    }

    const ingested = await ingestVitalBatch({
      patientId: parsedCookie.patientId,
      source: parsedCookie.mode,
      samples: samples.map((s) => ({ ...s, isSynthetic: false })),
      actorUserId: ctx.userId,
      isSynthetic: false,
    });

    if (ingested.recordsAccepted > 0) {
      const evaluation = await runAndPersistEvaluation({
        patientId: parsedCookie.patientId,
        actorUserId: ctx.userId,
      });
      await maybeTriggerAlertFromEvaluation({
        evaluation,
        actorUserId: ctx.userId,
      });
    }

    return redirectWithClear(
      `${origin}/ingest?connector=${parsedCookie.mode}&synced=${ingested.recordsAccepted}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Connected, but initial Google sync returned an error.';
    return redirectWithClear(
      `${origin}/ingest?connector=${parsedCookie.mode}&connector_warning=${encodeURIComponent(msg)}`,
    );
  }
}
