'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Role } from '@sentinel/shared';
import { ArrowRight, LogOut, ShieldCheck } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { getPortalConfig } from '@/lib/auth-portal';
import { getRoleWorkspaceConfig } from '@/lib/roles';

interface RoleWorkspaceGuardProps {
  allowedRoles: Role[];
  workspaceName: string;
  children: React.ReactNode;
}

/**
 * Keeps Patient, Caregiver, and Clinician interfaces cleanly separated and provides
 * 1-click sign-out into the target portal's dedicated login route.
 */
export function RoleWorkspaceGuard({
  allowedRoles,
  workspaceName,
  children,
}: RoleWorkspaceGuardProps) {
  const router = useRouter();
  const { data: session, isPending, refetch } = authClient.useSession();
  const [switching, setSwitching] = useState(false);
  const userRole = (session?.user as { role?: Role } | undefined)?.role;

  if (isPending || !session?.user || !userRole) {
    return <>{children}</>;
  }

  if (allowedRoles.includes(userRole)) {
    return <>{children}</>;
  }

  const targetCfg = getRoleWorkspaceConfig(userRole);
  const desiredPortal = allowedRoles.includes('clinician')
    ? getPortalConfig('clinician')
    : allowedRoles.includes('caregiver')
      ? getPortalConfig('caregiver')
      : getPortalConfig('patient');

  async function handleSwitchPortal() {
    setSwitching(true);
    try {
      await authClient.signOut();
      await refetch();
      router.push(desiredPortal.loginPath);
      router.refresh();
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="clinical-card mx-auto max-w-xl p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--bg-mint-panel)] text-[var(--brand-primary)]">
        <ShieldCheck className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="mt-4 font-[family-name:var(--font-display)] text-2xl font-bold">
        {targetCfg.badgeLabel} Active
      </h2>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        You are signed in as <strong>{session.user.name}</strong> ({userRole.replace('_', ' ')}).{' '}
        {workspaceName} is reserved for {allowedRoles.join(' / ')} accounts. Sign out below to log
        in as a separate {allowedRoles[0]} account.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={handleSwitchPortal}
          disabled={switching}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-5 text-sm font-semibold text-[var(--brand-primary-fg)] transition hover:opacity-95 disabled:opacity-60 cursor-pointer"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span>{switching ? 'Signing out...' : `Sign Out & Open ${workspaceName} Login`}</span>
        </button>
        <Link
          href={targetCfg.homeHref}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-5 text-sm font-semibold hover:bg-[var(--bg-elevated)]"
        >
          <span>Open {targetCfg.badgeLabel}</span>
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
