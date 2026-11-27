import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { appendAuditLog, getDb, withSystemDb, type AppDb } from '@/db';
import * as schema from '@/db/schema';
import { encryptPhi } from '@sentinel/shared';
import { eq } from 'drizzle-orm';
import { resolveGoogleAuthConfig } from './auth-config';

export function createSentinelAuth(
  env: NodeJS.ProcessEnv = process.env,
  db: AppDb = getDb(),
) {
  const phiKey =
    env.PHI_ENCRYPTION_KEY ??
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const googleCfg = resolveGoogleAuthConfig(env);
  const trustedOrigins = Array.from(
    new Set([
      googleCfg.baseUrl,
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3100',
      'http://127.0.0.1:3100',
    ]),
  );

  return betterAuth({
    baseURL: googleCfg.baseUrl,
    secret:
      env.BETTER_AUTH_SECRET ??
      'dev-better-auth-secret-replace-with-64-hex-chars-in-production-00',
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    ...(googleCfg.enabled && googleCfg.clientId && googleCfg.clientSecret
      ? {
          socialProviders: {
            google: {
              clientId: googleCfg.clientId,
              clientSecret: googleCfg.clientSecret,
              accessType: 'offline' as const,
              prompt: 'select_account' as const,
              ...(googleCfg.hostedDomain ? { hd: googleCfg.hostedDomain } : {}),
            },
          },
        }
      : {}),
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ['google'],
        // Prevent unverified local accounts from silently claiming verified Google logins.
        requireLocalEmailVerified: true,
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 120,
      customRules: {
        '/sign-in/email': {
          window: 60,
          max: 60,
        },
        '/sign-in/social': {
          window: 60,
          max: 60,
        },
      },
    },
    user: {
      additionalFields: {
        role: {
          type: 'string',
          required: true,
          defaultValue: 'patient',
          input: true,
        },
        locale: {
          type: 'string',
          required: true,
          defaultValue: 'en',
          input: true,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (createdUser) => {
            const role = (createdUser as { role?: string }).role ?? 'patient';
            const locale = (createdUser as { locale?: string }).locale ?? 'en';
            const displayName =
              createdUser.name?.trim() || createdUser.email.split('@')[0] || 'Member';

            await withSystemDb(async (tx) => {
              if (role === 'patient') {
                const existing = await tx
                  .select({ id: schema.patientProfiles.id })
                  .from(schema.patientProfiles)
                  .where(eq(schema.patientProfiles.userId, createdUser.id))
                  .limit(1);

                if (existing.length === 0) {
                  const code = `PAT-${createdUser.id.slice(0, 6).toUpperCase()}`;
                  await tx.insert(schema.patientProfiles).values({
                    userId: createdUser.id,
                    displayCode: code,
                    fullNameEnc: encryptPhi(displayName, phiKey),
                    locale,
                  });
                }
              }

              await appendAuditLog(tx, {
                actorUserId: createdUser.id,
                action: 'auth.user_registered',
                targetType: 'user',
                targetId: createdUser.id,
                payload: {
                  role,
                  locale,
                  emailVerified: Boolean(createdUser.emailVerified),
                },
              });
            });
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

export const auth = createSentinelAuth();
