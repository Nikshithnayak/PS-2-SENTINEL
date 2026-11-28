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
  callbackUrl?: string;
}

function redirectWithClear(url: string) {
  const res = NextResponse.redirect(url);
  res.cookies.delete(CONNECTOR_STATE_COOKIE);
  return res;
}

export async function handleGoogleConnectorCallback(request: NextRequest) {
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
      redirect_uri: parsedCookie.callbackUrl || oauthCfg.callbackUrl,
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

  // Immediately pull last 14 days (336h) of vitals cleanly after connecting so 14-day baseline starts learning immediately
  const endIso = new Date().toISOString();
  const startIso = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
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
        `${origin}/ingest?connector=${parsedCookie.mode}&synced=0&connector_warning=${encodeURIComponent('Google Fit authorized, but Google returned 0 readings in the last 14 days. Ensure Google Fit phone sync has stored data, or pair Android Health Connect Direct Bridge next to this card.')}`,
      );
    }

    const metricCounts: Record<string, number> = {};
    for (const s of samples) {
      metricCounts[s.metricType] = (metricCounts[s.metricType] ?? 0) + 1;
    }
    const breakdownLabel = Object.entries(metricCounts)
      .map(([m, c]) => `${m}: ${c}`)
      .join(', ');
    const hrCount = (metricCounts.heart_rate ?? 0) + (metricCounts.resting_heart_rate ?? 0);

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

    const extraParams = new URLSearchParams({
      connector: parsedCookie.mode,
      synced: String(ingested.recordsAccepted),
    });
    if (breakdownLabel) extraParams.set('synced_summary', breakdownLabel);
    if (parsedCookie.mode === 'google_fit' && hrCount === 0) {
      extraParams.set(
        'connector_warning',
        `Google Fit returned ${ingested.recordsAccepted} sample(s) (${breakdownLabel}), but 0 Heart Rate readings in the last 14 days. Verify Heart Rate sync inside Google Fit / Health Connect or pair Android Health Connect Direct Bridge.`,
      );
    }

    return redirectWithClear(`${origin}/ingest?${extraParams.toString()}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Connected, but initial Google sync returned an error.';
    return redirectWithClear(
      `${origin}/ingest?connector=${parsedCookie.mode}&connector_warning=${encodeURIComponent(msg)}`,
    );
  }
}
