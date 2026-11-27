'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@sentinel/shared';
import { Activity } from 'lucide-react';
import { SyntheticBadge } from '@/components/health/status-badge';
import { authClient } from '@/lib/auth-client';
import { getRoleWorkspaceConfig } from '@/lib/roles';

export function SentinelNav({
  title,
  isSynthetic = false,
  rightSlot,
}: {
  title?: string;
  isSynthetic?: boolean;
  rightSlot?: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  const userRole = ((session?.user as { role?: Role } | undefined)?.role ?? 'patient') as Role;
  const workspace = getRoleWorkspaceConfig(userRole);
  const roleLinks = workspace.sidebarGroups.flatMap((g) => g.items);

  return (
    <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <Link
            href={session?.user ? workspace.homeHref : '/'}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-3 text-sm font-semibold text-[var(--brand-primary-fg)]"
          >
            <Activity className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>SENTINEL</span>
          </Link>
          {title && (
            <h1 className="font-[family-name:var(--font-display)] text-lg font-semibold sm:text-xl">
              {title}
            </h1>
          )}
          {isSynthetic && <SyntheticBadge />}
        </div>

        <nav aria-label="Workspace views" className="flex flex-wrap items-center gap-1.5">
          {roleLinks.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === '/clinician'
                ? pathname === '/clinician'
                : item.href === '/settings'
                  ? pathname === '/settings'
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={`${item.href}-${item.label}`}
                href={item.href}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition sm:text-sm ${active
                  ? 'border-[var(--brand-rail-active)] bg-[var(--brand-rail-active)] text-[var(--brand-rail-active-fg)]'
                  : 'border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]'
                  }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
          {rightSlot}
        </nav>
      </div>
    </header>
  );
}
