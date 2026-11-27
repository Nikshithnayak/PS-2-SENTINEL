import { NextResponse, type NextRequest } from 'next/server';
import { encryptPhi } from '@sentinel/shared';
import { eq } from 'drizzle-orm';
import { appendAuditLog, withSystemDb } from '@/db';
import { patientProfiles, user } from '@/db/schema';
import { auth } from '@/lib/auth';
import {
  getPortalConfig,
  PORTAL_ROLE_COOKIE,
  portalForRole,
  verifyPortalRoleIntent,
  type PortalKind,
} from '@/lib/auth-portal';

export async function GET(request: NextRequest) {
  const cookieToken = request.cookies.get(PORTAL_ROLE_COOKIE)?.value;
  const cookiePortal = verifyPortalRoleIntent(cookieToken);
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    const fallbackLogin = cookiePortal ? getPortalConfig(cookiePortal).loginPath : '/auth';
    const res = NextResponse.redirect(new URL(`${fallbackLogin}?oauthError=session_missing`, request.url));
    res.cookies.delete(PORTAL_ROLE_COOKIE);
    return res;
  }

  const currentRole = ((session.user as { role?: string }).role ?? 'patient') as string;
  let effectivePortal: PortalKind = portalForRole(currentRole);

  // Preserve the portal chosen before Google OAuth (Caregiver or Clinician accounts must not get
  // stuck in default `patient` mode when authenticating through their dedicated portal).
  if (cookiePortal && currentRole !== 'org_admin') {
    effectivePortal = cookiePortal;

    if (currentRole !== cookiePortal) {
      const phiKey =
        process.env.PHI_ENCRYPTION_KEY ??
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const userId = session.user.id;
      const displayName = session.user.name?.trim() || session.user.email.split('@')[0] || 'Member';

      await withSystemDb(async (tx) => {
        await tx
          .update(user)
          .set({ role: cookiePortal, updatedAt: new Date() })
          .where(eq(user.id, userId));

        if (cookiePortal === 'patient') {
          const existing = await tx
            .select({ id: patientProfiles.id })
            .from(patientProfiles)
            .where(eq(patientProfiles.userId, userId))
            .limit(1);
          if (existing.length === 0) {
            await tx.insert(patientProfiles).values({
              userId,
              displayCode: `PAT-${userId.slice(0, 6).toUpperCase()}`,
              fullNameEnc: encryptPhi(displayName, phiKey),
              locale: 'en',
            });
          }
        }

        await appendAuditLog(tx, {
          actorUserId: userId,
          action: 'auth.portal_role_activated',
          targetType: 'user',
          targetId: userId,
          payload: { previousRole: currentRole, nextRole: cookiePortal, via: 'google_oauth' },
        });
      });
    }
  }

  const dest =
    currentRole === 'org_admin' ? '/clinician' : getPortalConfig(effectivePortal).homeHref;
  const res = NextResponse.redirect(new URL(dest, request.url));
  res.cookies.delete(PORTAL_ROLE_COOKIE);
  return res;
}
