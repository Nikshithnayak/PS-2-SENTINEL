import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { getDb, withSystemDb } from '@/db';
import * as schema from '@/db/schema';
import { encryptPhi } from '@sentinel/shared';
import { eq } from 'drizzle-orm';

const PHI_KEY =
  process.env.PHI_ENCRYPTION_KEY ??
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  secret:
    process.env.BETTER_AUTH_SECRET ??
    'dev-better-auth-secret-replace-with-64-hex-chars-in-production-00',
  trustedOrigins: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3100',
    'http://127.0.0.1:3100',
  ],
  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
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
          if (role !== 'patient') return;
          await withSystemDb(async (tx) => {
            const existing = await tx
              .select({ id: schema.patientProfiles.id })
              .from(schema.patientProfiles)
              .where(eq(schema.patientProfiles.userId, createdUser.id))
              .limit(1);
            if (existing.length > 0) return;

            const code = `PAT-${createdUser.id.slice(0, 6).toUpperCase()}`;
            await tx.insert(schema.patientProfiles).values({
              userId: createdUser.id,
              displayCode: code,
              fullNameEnc: encryptPhi(createdUser.name, PHI_KEY),
              locale: (createdUser as { locale?: string }).locale ?? 'en',
            });
          });
        },
      },
    },
  },
  plugins: [nextCookies()],
});
