'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Role } from '@sentinel/shared';
import { Activity, BellRing, BookOpen, LogIn, Palette } from 'lucide-react';
import { SyntheticBadge } from '@/components/health/status-badge';
import { authClient } from '@/lib/auth-client';
import { getPortalConfig, portalForRole } from '@/lib/auth-portal';
import { getRoleWorkspaceConfig } from '@/lib/roles';

export function SentinelShell({
  title,
  subtitle,
  isSynthetic = false,
  rightSlot,
  children,
}: {
  title: string;
  subtitle?: string;
  isSynthetic?: boolean;
  rightSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
  const userRole = ((session?.user as { role?: Role } | undefined)?.role ?? 'patient') as Role;
  const workspace = getRoleWorkspaceConfig(userRole);
  const authHref = session?.user
    ? getPortalConfig(portalForRole(userRole)).loginPath
    : pathname.startsWith('/caregiver')
      ? '/caregiver/login'
      : pathname.startsWith('/clinician')
        ? '/clinician/login'
        : '/auth';

  function isActivePath(href: string) {
    if (href === '/clinician' && pathname.startsWith('/clinician/report')) return false;
    if (href === '/settings' && pathname.startsWith('/settings/consent')) return false;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <div className="min-h-dvh overflow-x-clip bg-[var(--bg-base)] text-[var(--text-primary)] pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-0 print:pb-0">
      {/* Role-Specific Left Rail Navigation */}
      <aside
        aria-label="Primary sidebar navigation"
        className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col justify-between border-r border-[var(--border-subtle)] bg-[var(--bg-rail)] lg:flex print:hidden"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
          <Link
            href={session?.user ? workspace.homeHref : '/'}
            className="flex shrink-0 items-center gap-3 rounded-2xl px-2 py-1.5 transition hover:bg-[var(--bg-elevated)]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]">
              <Activity className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="font-[family-name:var(--font-display)] text-base font-bold leading-tight text-[var(--text-primary)]">
                Sachet · SENTINEL
              </p>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {workspace.portalSubtitle}
              </p>
            </div>
          </Link>

          <div className="mt-3 px-1">
            <span
              className={`inline-flex w-full items-center justify-center rounded-xl border px-2.5 py-1.5 text-xs font-bold ${workspace.badgeClassName}`}
            >
              {workspace.badgeLabel}
            </span>
          </div>

          <nav aria-label="Role workspaces" className="mt-4 space-y-4">
            {workspace.sidebarGroups.map((group) => (
              <div key={group.id}>
                <p className="px-3 text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  {group.title}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = isActivePath(item.href);
                    return (
                      <li key={`${group.id}-${item.href}-${item.label}`}>
                        <Link
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          className={`flex min-h-10 items-center gap-3 rounded-xl px-3 py-1.5 text-sm font-semibold transition ${active
                            ? 'bg-[var(--brand-rail-active)] text-[var(--brand-rail-active-fg)] shadow-xs'
                            : 'text-[var(--text-primary)] hover:bg-[var(--bg-mint-panel)]'
                            }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="shrink-0 space-y-1 border-t border-[var(--border-subtle)] px-4 py-3">
          <Link
            href="/model-card"
            className="flex min-h-10 items-center gap-2.5 rounded-xl px-3 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-mint-panel)] hover:text-[var(--text-primary)]"
          >
            <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Model Card &amp; Safety</span>
          </Link>
          <Link
            href="/design"
            className="flex min-h-10 items-center gap-2.5 rounded-xl px-3 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-mint-panel)] hover:text-[var(--text-primary)]"
          >
            <Palette className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Design Tokens</span>
          </Link>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="lg:pl-64 print:pl-0">
        <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] pt-[env(safe-area-inset-top)] print:hidden">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
              <Link
                href={session?.user ? workspace.homeHref : '/'}
                aria-label="Sachet SENTINEL Home"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-3 text-sm font-semibold text-[var(--brand-primary-fg)] lg:hidden"
              >
                <Activity className="h-4 w-4" aria-hidden="true" />
                <span>SENTINEL</span>
              </Link>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-[family-name:var(--font-display)] text-lg font-bold leading-tight sm:text-xl">
                    {title}
                  </h1>
                  {session?.user && (
                    <span
                      data-testid="role-workspace-badge"
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${workspace.badgeClassName}`}
                    >
                      {workspace.badgeLabel}
                    </span>
                  )}
                  {isSynthetic && <SyntheticBadge />}
                </div>
                {subtitle && (
                  <p className="text-xs text-[var(--text-muted)]">{subtitle}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {rightSlot}
              <Link
                href="/alerts"
                aria-label="Open alert notifications"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-primary)] transition hover:bg-[var(--bg-elevated)]"
              >
                <BellRing className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href={authHref}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--bg-elevated)] sm:text-sm"
              >
                {session?.user ? (
                  <>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--brand-primary)] text-[11px] font-bold text-[var(--brand-primary-fg)]">
                      {session.user.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="max-w-32 truncate">{session.user.name}</span>
                    <span className="hidden rounded-full bg-[var(--bg-mint-panel)] px-2 py-0.5 text-[11px] font-semibold capitalize text-[var(--brand-accent-text)] sm:inline">
                      {userRole.replace('_', ' ')}
                    </span>
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
                    <span>Sign In</span>
                  </>
                )}
              </Link>
            </div>
          </div>

          <nav
            aria-label="Mobile workspace links"
            className="mx-auto flex max-w-7xl gap-2 overflow-x-auto border-t border-[var(--border-subtle)] px-4 py-2 lg:hidden"
          >
            {workspace.mobileQuickLinks.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-xs font-semibold text-[var(--text-primary)]"
                >
                  <Icon className="h-3.5 w-3.5 text-[var(--brand-primary)]" aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </header>

        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</div>
      </div>

      {/* Role-Specific Mobile Bottom Tab Bar */}
      <nav
        aria-label="Mobile quick navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-1 pb-[calc(0.375rem+env(safe-area-inset-bottom))] pt-1.5 lg:hidden print:hidden"
      >
        {workspace.mobileTabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActivePath(tab.href);
          return (
            <Link
              key={`${tab.href}-${tab.label}`}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[11px] font-semibold ${active
                ? 'bg-[var(--bg-mint-panel)] text-[var(--brand-accent-text)]'
                : 'text-[var(--text-muted)]'
                }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
