import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import type { ConsentScope, Role } from '@sentinel/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { withSystemDb } from '@/db';
import { consentGrants, patientProfiles } from '@/db/schema';
import { auth } from './auth';

export interface SessionContext {
  userId: string;
  email: string;
  name: string;
  role: Role;
  locale: string;
}

export async function getSessionContext(): Promise<SessionContext | null> {
  const hdrs = await headers();
  const session = await auth.api.getSession({ headers: hdrs });
  if (!session?.user) return null;

  const u = session.user as unknown as {
    id: string;
    email: string;
    name: string;
    role?: string;
    locale?: string;
  };
  return {
    userId: u.id,
    email: u.email,
    name: u.name,
    role: (u.role as Role) ?? 'patient',
    locale: u.locale ?? 'en',
  };
}

export async function requireSession(): Promise<
  { ctx: SessionContext; error?: never } | { ctx?: never; error: NextResponse }
> {
  const ctx = await getSessionContext();
  if (!ctx) {
    return {
      error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    };
  }
  return { ctx };
}

/**
 * Verifies that `ctx.userId` owns `patientId`, is an `org_admin` for de-identified routes,
 * or holds an active non-withdrawn consent grant covering `requiredScope`.
 */
export async function checkPatientScope(
  ctx: SessionContext,
  patientId: string,
  requiredScope: ConsentScope,
): Promise<boolean> {
  return withSystemDb(async (tx) => {
    const profile = await tx
      .select({ userId: patientProfiles.userId })
      .from(patientProfiles)
      .where(eq(patientProfiles.id, patientId))
      .limit(1);

    if (profile[0]?.userId === ctx.userId) {
      return true;
    }

    const grants = await tx
      .select({ scopes: consentGrants.scopes })
      .from(consentGrants)
      .where(
        and(
          eq(consentGrants.patientId, patientId),
          eq(consentGrants.granteeUserId, ctx.userId),
          isNull(consentGrants.withdrawnAt),
        ),
      );

    return grants.some((g) => g.scopes.includes(requiredScope));
  });
}
