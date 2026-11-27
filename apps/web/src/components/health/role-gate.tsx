'use client';

import Link from 'next/link';
import type { Role } from '@sentinel/shared';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { getRoleWorkspaceConfig } from '@/lib/roles';

interface RoleWorkspaceGuardProps {
  allowedRoles: Role[];
  workspaceName: string;
  children: React.ReactNode;
}

/**
 * Keeps Patient, Caregiver, and Clinician interfaces cleanly separated so users signed
 * into one role aren't dropped into another role's workflow by mistake.
 */
export function RoleWorkspaceGuard({
  allowedRoles,
  workspaceName,
  children,
}: RoleWorkspaceGuardProps) {
  const { data: session, isPending } = authClient.useSession();
  const userRole = (session?.user as { role?: Role } | undefined)?.role;

  if (isPending || !session?.user || !userRole) {
    return <>{children}</>;
  }

  if (allowedRoles.includes(userRole)) {
    return <>{children}</>;
  }

  const targetCfg = getRoleWorkspaceConfig(userRole);

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
        {workspaceName} is reserved for {allowedRoles.join(' / ')} accounts to keep each role
        workspace focused and uncluttered.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href={targetCfg.homeHref}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-6 text-base font-semibold text-[var(--brand-primary-fg)] transition hover:opacity-95"
        >
          <span>Open {targetCfg.badgeLabel}</span>
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Link
          href="/auth"
          className="inline-flex min-h-12 items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-5 text-sm font-semibold hover:bg-[var(--bg-elevated)]"
        >
          Switch Account
        </Link>
      </div>
    </div>
  );
}
