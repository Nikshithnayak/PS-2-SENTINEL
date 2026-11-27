import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Role } from '@sentinel/shared';

export type PortalKind = 'patient' | 'caregiver' | 'clinician';

export const PORTAL_ROLE_COOKIE = 'sentinel_portal_role';
const MAX_INTENT_AGE_MS = 15 * 60 * 1000;

export function getPortalConfig(portal: PortalKind): {
  portal: PortalKind;
  defaultRole: Role;
  homeHref: string;
  loginPath: string;
  title: string;
} {
  switch (portal) {
    case 'caregiver':
      return {
        portal: 'caregiver',
        defaultRole: 'caregiver',
        homeHref: '/caregiver',
        loginPath: '/caregiver/login',
        title: 'Caregiver & Family Monitor',
      };
    case 'clinician':
      return {
        portal: 'clinician',
        defaultRole: 'clinician',
        homeHref: '/clinician',
        loginPath: '/clinician/login',
        title: 'Clinician Workstation System',
      };
    case 'patient':
    default:
      return {
        portal: 'patient',
        defaultRole: 'patient',
        homeHref: '/today',
        loginPath: '/auth',
        title: 'Patient · Elder Portal',
      };
  }
}

export function portalForRole(role: string | null | undefined): PortalKind {
  if (role === 'caregiver') return 'caregiver';
  if (role === 'clinician' || role === 'org_admin') return 'clinician';
  return 'patient';
}

function getIntentSecret(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.BETTER_AUTH_SECRET ??
    'dev-better-auth-secret-replace-with-64-hex-chars-in-production-00'
  );
}

/**
 * Signs an OAuth portal-role intent cookie (`patient | caregiver | clinician`).
 * Deliberately excludes `org_admin` so self-service OAuth cannot elevate to org admin.
 */
export function signPortalRoleIntent(
  role: PortalKind,
  env: NodeJS.ProcessEnv = process.env,
  nowMs = Date.now(),
): string {
  const payload = `${role}.${nowMs}`;
  const sig = createHmac('sha256', getIntentSecret(env)).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyPortalRoleIntent(
  token: string | undefined | null,
  env: NodeJS.ProcessEnv = process.env,
  nowMs = Date.now(),
): PortalKind | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [role, tsRaw, sig] = parts;
  if (role !== 'patient' && role !== 'caregiver' && role !== 'clinician') return null;

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || nowMs - ts > MAX_INTENT_AGE_MS || ts - nowMs > 60_000) {
    return null;
  }

  const expected = createHmac('sha256', getIntentSecret(env)).update(`${role}.${tsRaw}`).digest('hex');
  try {
    const a = Buffer.from(sig ?? '', 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length === 0 || a.length !== b.length) return null;
    return timingSafeEqual(a, b) ? role : null;
  } catch {
    return null;
  }
}
