import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  buildGoogleConnectorAuthUrl,
  resolveGoogleConnectorOAuthConfig,
  resolveRequestOrigin,
  type GoogleHealthMode,
} from '@/lib/ingestion/connectors/google-cloud-health';
import { resolveSessionPatientScope } from '@/lib/ingestion/auth';
import { getSessionContext } from '@/lib/session';

const CONNECTOR_STATE_COOKIE = 'sentinel_gconn_state';
const PatientIdSchema = z.string().uuid();

export async function GET(request: NextRequest) {
  const origin = resolveRequestOrigin(request);
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.redirect(`${origin}/auth?next=/ingest`);
  }

  const rawMode = request.nextUrl.searchParams.get('mode')?.toLowerCase();
  const mode: GoogleHealthMode =
    rawMode === 'health' || rawMode === 'google_health_api' ? 'google_health_api' : 'google_fit';

  const rawPatient = request.nextUrl.searchParams.get('patientId') ?? undefined;
  if (rawPatient !== undefined && !PatientIdSchema.safeParse(rawPatient).success) {
    return NextResponse.redirect(
      `${origin}/ingest?connector_error=${encodeURIComponent('Invalid patient identifier.')}`,
    );
  }

  const scoped = await resolveSessionPatientScope(ctx, rawPatient);
  if (scoped.error) {
    return NextResponse.redirect(
      `${origin}/ingest?connector_error=${encodeURIComponent('Patient profile required before connecting Google Fit.')}`,
    );
  }

  const oauthCfg = resolveGoogleConnectorOAuthConfig(mode, origin);
  if (!oauthCfg.configured || !oauthCfg.clientId) {
    return NextResponse.redirect(
      `${origin}/ingest?connector_error=${encodeURIComponent('Set GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET first (see docs/SETUP-NEEDED.md).')}`,
    );
  }

  const state = `gfit_${randomBytes(24).toString('base64url')}`;
  const cookiePayload = JSON.stringify({
    state,
    userId: ctx.userId,
    patientId: scoped.patientId,
    mode,
    origin: oauthCfg.origin,
    callbackUrl: oauthCfg.callbackUrl,
  });

  const redirectUrl = buildGoogleConnectorAuthUrl({
    mode,
    clientId: oauthCfg.clientId,
    callbackUrl: oauthCfg.callbackUrl,
    state,
    loginHint: ctx.email,
  });

  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set(CONNECTOR_STATE_COOKIE, cookiePayload, {
    httpOnly: true,
    sameSite: 'lax',
    secure: oauthCfg.origin.startsWith('https://'),
    path: '/',
    maxAge: 600,
  });
  return response;
}
