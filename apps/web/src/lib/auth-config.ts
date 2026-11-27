export interface GoogleAuthConfig {
  enabled: boolean;
  clientId: string | null;
  clientSecret: string | null;
  hostedDomain: string | null;
  baseUrl: string;
  callbackUrl: string;
  missingEnvVars: string[];
}

export interface PublicAuthProvidersStatus {
  google: {
    enabled: boolean;
    callbackUrl: string;
    hostedDomain: string | null;
    missingEnvVars: string[];
  };
}

/**
 * Resolves real Google OAuth 2.0 credentials and redirect URI for Better Auth.
 * Intentionally never aliases `GOOGLE_HEALTH_CLIENT_ID` because user sign-in
 * OAuth apps and Google Health API wearable connectors have separate scopes.
 */
export function resolveGoogleAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): GoogleAuthConfig {
  const vercelUrl = env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
    ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`
    : env.VERCEL_URL?.trim()
      ? `https://${env.VERCEL_URL.trim()}`
      : '';
  const baseUrl = (
    env.BETTER_AUTH_URL?.trim() ||
    env.NEXT_PUBLIC_APP_URL?.trim() ||
    vercelUrl ||
    'http://localhost:3000'
  ).replace(/\/$/, '');

  const clientId = env.GOOGLE_CLIENT_ID?.trim() || env.AUTH_GOOGLE_ID?.trim() || null;
  const clientSecret =
    env.GOOGLE_CLIENT_SECRET?.trim() || env.AUTH_GOOGLE_SECRET?.trim() || null;
  const hostedDomain = env.GOOGLE_HOSTED_DOMAIN?.trim() || null;

  const missingEnvVars: string[] = [];
  if (!clientId) missingEnvVars.push('GOOGLE_CLIENT_ID');
  if (!clientSecret) missingEnvVars.push('GOOGLE_CLIENT_SECRET');

  return {
    enabled: Boolean(clientId && clientSecret),
    clientId,
    clientSecret,
    hostedDomain,
    baseUrl,
    callbackUrl: `${baseUrl}/api/auth/callback/google`,
    missingEnvVars,
  };
}

/**
 * Strips secrets and returns safe public provider availability metadata for `/auth`.
 */
export function getPublicAuthProvidersStatus(
  env: NodeJS.ProcessEnv = process.env,
): PublicAuthProvidersStatus {
  const google = resolveGoogleAuthConfig(env);
  return {
    google: {
      enabled: google.enabled,
      callbackUrl: google.callbackUrl,
      hostedDomain: google.hostedDomain,
      missingEnvVars: google.missingEnvVars,
    },
  };
}
