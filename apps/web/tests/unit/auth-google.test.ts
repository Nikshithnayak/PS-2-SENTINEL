import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, closeDb, getDb } from '@/db';
import { ensurePostgresRunning, type LocalPgHandle } from '@/db/local-pg';
import { createSentinelAuth } from '@/lib/auth';
import { getPublicAuthProvidersStatus, resolveGoogleAuthConfig } from '@/lib/auth-config';
import { signPortalRoleIntent, verifyPortalRoleIntent } from '@/lib/auth-portal';

let pgHandle: LocalPgHandle;

beforeAll(async () => {
  await closeDb();
  pgHandle = await ensurePostgresRunning(5440);
  process.env.DATABASE_URL = pgHandle.url;
  await applyMigrations();
});

afterAll(async () => {
  await closeDb();
  await pgHandle?.stop();
});

describe('Real Google OAuth Authentication (Better Auth)', () => {
  it('reports non-secret provider availability and callback URI safely', () => {
    const missing = getPublicAuthProvidersStatus({
      BETTER_AUTH_URL: 'http://localhost:3000',
    } as unknown as NodeJS.ProcessEnv);
    expect(missing.google.enabled).toBe(false);
    expect(missing.google.callbackUrl).toBe('http://localhost:3000/api/auth/callback/google');
    expect(missing.google.missingEnvVars).toEqual(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);

    const ready = resolveGoogleAuthConfig({
      NEXT_PUBLIC_APP_URL: 'https://sentinel.example.org/',
      GOOGLE_CLIENT_ID: '123456-test.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'gsec-test-secret',
      GOOGLE_HOSTED_DOMAIN: 'nitte.edu.in',
    } as unknown as NodeJS.ProcessEnv);
    expect(ready.enabled).toBe(true);
    expect(ready.callbackUrl).toBe('https://sentinel.example.org/api/auth/callback/google');
    expect(ready.hostedDomain).toBe('nitte.edu.in');

    const safeStatus = getPublicAuthProvidersStatus({
      NEXT_PUBLIC_APP_URL: 'https://sentinel.example.org',
      GOOGLE_CLIENT_ID: '123456-test.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'super-secret-value-never-exposed',
    } as unknown as NodeJS.ProcessEnv);
    expect(safeStatus.google.enabled).toBe(true);
    expect(JSON.stringify(safeStatus)).not.toContain('super-secret-value-never-exposed');
  });

  it('rejects /api/auth/sign-in/social for google when credentials are unconfigured', async () => {
    const unconfiguredAuth = createSentinelAuth(
      {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      } as unknown as NodeJS.ProcessEnv,
      getDb(),
    );

    const res = await unconfiguredAuth.handler(
      new Request('http://localhost:3000/api/auth/sign-in/social', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          provider: 'google',
          callbackURL: '/settings/consent',
          disableRedirect: true,
        }),
      }),
    );

    expect(res.status).toBe(404);
  });

  it('generates a real PKCE Google OAuth 2.0 authorization URL when GOOGLE_CLIENT_ID/SECRET are set', async () => {
    const googleAuth = createSentinelAuth(
      {
        BETTER_AUTH_URL: 'http://localhost:3000',
        BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        GOOGLE_CLIENT_ID: '1234567890-sentinel.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'GOCSPX-test-secret-for-oauth-url-generation',
      } as unknown as NodeJS.ProcessEnv,
      getDb(),
    );

    const res = await googleAuth.handler(
      new Request('http://localhost:3000/api/auth/sign-in/social', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({
          provider: 'google',
          callbackURL: '/settings/consent',
          disableRedirect: true,
        }),
      }),
    );

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { url?: string; redirect?: boolean };
    expect(payload.url).toBeTruthy();

    const authUrl = new URL(payload.url!);
    expect(authUrl.origin).toBe('https://accounts.google.com');
    expect(authUrl.pathname).toBe('/o/oauth2/v2/auth');
    expect(authUrl.searchParams.get('client_id')).toBe(
      '1234567890-sentinel.apps.googleusercontent.com',
    );
    expect(authUrl.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/api/auth/callback/google',
    );
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('state')).toBeTruthy();
    const scopes = authUrl.searchParams.get('scope') ?? '';
    expect(scopes).toContain('email');
    expect(scopes).toContain('profile');
    expect(scopes).toContain('openid');
  });

  it('signs and verifies HMAC portal role intent tokens without accepting tampered or non-portal roles', () => {
    const env = {
      BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    } as unknown as NodeJS.ProcessEnv;
    const now = 1_700_000_000_000;

    const cgToken = signPortalRoleIntent('caregiver', env, now);
    const clToken = signPortalRoleIntent('clinician', env, now);
    expect(verifyPortalRoleIntent(cgToken, env, now + 5_000)).toBe('caregiver');
    expect(verifyPortalRoleIntent(clToken, env, now + 5_000)).toBe('clinician');

    const tampered = cgToken.replace('caregiver', 'clinician');
    expect(verifyPortalRoleIntent(tampered, env, now + 5_000)).toBeNull();
    expect(verifyPortalRoleIntent(cgToken, env, now + 20 * 60 * 1000)).toBeNull();
    expect(verifyPortalRoleIntent(`org_admin.${now}.deadbeef`, env, now)).toBeNull();
  });
});
