'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  BellRing,
  Database,
  FlaskConical,
  HeartHandshake,
  LineChart,
  Settings,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

const NAV_LINKS = [
  { href: '/today', label: 'Today (Elder)', icon: HeartHandshake },
  { href: '/caregiver', label: 'Caregiver', icon: ShieldCheck },
  { href: '/clinician', label: 'Clinician', icon: Stethoscope },
  { href: '/signals', label: 'Signals', icon: LineChart },
  { href: '/alerts', label: 'Alerts', icon: BellRing },
  { href: '/ingest', label: 'Import', icon: Database },
  { href: '/settings', label: 'Settings', icon: Settings },
];

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

  return (
    <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <Link
            href="/"
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
          {isSynthetic && (
            <span
              data-testid="global-synthetic-badge"
              className="inline-flex items-center gap-1 rounded-full bg-[var(--status-synthetic-bg)] px-2.5 py-1 text-xs font-bold text-[var(--status-synthetic)]"
            >
              <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
              SYNTHETIC
            </span>
          )}
        </div>

        <nav aria-label="Workspace views" className="flex flex-wrap items-center gap-1.5">
          {NAV_LINKS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition sm:text-sm ${
                  active
                    ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]'
                    : 'border-[var(--border-subtle)] hover:bg-[var(--bg-elevated)]'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
          {rightSlot}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
