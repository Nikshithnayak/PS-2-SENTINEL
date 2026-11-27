import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { appendAuditLog, getDb, withSystemDb, type AppDb } from '@/db';
import * as schema from '@/db/schema';
import { encryptPhi } from '@sentinel/shared';
import { and, eq, isNull } from 'drizzle-orm';
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
      ...(env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
        ? [`https://${env.VERCEL_PROJECT_PRODUCTION_URL.trim()}`]
        : []),
      ...(env.VERCEL_URL?.trim() ? [`https://${env.VERCEL_URL.trim()}`] : []),
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
        '/sign-up/email': {
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

              // Link any pending Care Circle invitations addressed to this user's email
              const normalizedEmail = createdUser.email.trim().toLowerCase();
              const pendingInvites = await tx
                .select()
                .from(schema.careCircleMembers)
                .where(
                  and(
                    eq(schema.careCircleMembers.invitedEmail, normalizedEmail),
                    isNull(schema.careCircleMembers.memberUserId),
                  ),
                );

              for (const invite of pendingInvites) {
                await tx
                  .update(schema.careCircleMembers)
                  .set({ memberUserId: createdUser.id, status: 'active' })
                  .where(eq(schema.careCircleMembers.id, invite.id));

                const grantScopes =
                  invite.relationship === 'clinician'
                    ? ['vitals_read', 'alerts_receive', 'checkin_view', 'clinician_export']
                    : ['vitals_read', 'alerts_receive', 'checkin_view'];
                const grantRel =
                  invite.relationship === 'clinician' ? 'clinician' : 'caregiver';

                await tx.insert(schema.consentGrants).values({
                  patientId: invite.patientId,
                  granteeUserId: createdUser.id,
                  relationship: grantRel,
                  scopes: grantScopes,
                  reason: 'Care Circle invitation accepted on registration',
                });

                await appendAuditLog(tx, {
                  actorUserId: createdUser.id,
                  action: 'care_circle.invite_accepted',
                  targetType: 'care_circle_member',
                  targetId: invite.id,
                  payload: { patientId: invite.patientId, relationship: invite.relationship },
                });
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
