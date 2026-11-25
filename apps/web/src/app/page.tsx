import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Database,
  Lock,
  Palette,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { getPool } from '@/db';
import { getSessionContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await getSessionContext();

  let dbConnected = false;
  let profileCount = 0;
  try {
    const res = await getPool().query('SELECT count(*)::int AS cnt FROM audit_logs');
    dbConnected = true;
    profileCount = Number(res.rows[0]?.cnt ?? 0);
  } catch {
    dbConnected = false;
  }

  return (
    <div className="min-h-dvh bg-[var(--bg-base)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]">
              <Activity className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-[family-name:var(--font-display)] text-lg font-semibold leading-tight">
                Sachet · SENTINEL
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                Wearable Early-Awareness Platform · Phase 1 Foundations
              </p>
            </div>
          </div>
          <nav aria-label="Primary navigation" className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Link
              href="/ingest"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 text-sm font-medium hover:bg-[var(--bg-elevated)]"
            >
              <Database className="h-4 w-4" aria-hidden="true" />
              <span>Data & Import</span>
            </Link>
            <Link
              href="/design"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 text-sm font-medium hover:bg-[var(--bg-elevated)]"
            >
              <Palette className="h-4 w-4" aria-hidden="true" />
              <span>Design Tokens</span>
            </Link>
            <Link
              href="/settings/consent"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 text-sm font-medium hover:bg-[var(--bg-elevated)]"
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              <span>Consent Ledger</span>
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 sm:p-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-[var(--status-stable-bg)] px-3 py-1 text-xs font-semibold text-[var(--status-stable)]">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Screening & Early Awareness · Non-Diagnostic</span>
          </div>

          <h1 className="mt-4 max-w-3xl font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight sm:text-4xl">
            Personal physiological baselines that spot deterioration days before crisis.
          </h1>
          <p className="mt-4 max-w-2xl text-base text-[var(--text-muted)]">
            Built for elderly home care and Nitte Pharma Innovation Centre Problem S2. Phase 1
            establishes cryptographic PHI protection, DPDP-aligned consent ledgers, PostgreSQL Row-Level
            Security, and accessible clinical design tokens.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              href="/auth"
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-5 py-3 text-base font-semibold text-[var(--brand-primary-fg)] transition hover:opacity-95"
            >
              <span>{session ? `Signed in as ${session.name} (${session.role})` : 'Sign In / Switch Role'}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/settings/consent"
              className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-5 py-3 text-base font-medium text-[var(--text-primary)] hover:opacity-90"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              <span>Open Consent & Audit Ledger</span>
            </Link>
          </div>
        </section>

        <section
          aria-label="Live System Verification"
          className="mt-8 grid gap-4 sm:grid-cols-3"
        >
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
              <Database className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
              <span>PostgreSQL & RLS</span>
            </div>
            <p className="mt-2 font-[family-name:var(--font-mono)] text-xl font-semibold tabular-nums">
              {dbConnected ? 'Connected' : 'Unavailable'}
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Partitioned vitals + FORCE RLS active
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
              <Lock className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
              <span>Hash-Chained Audit Ledger</span>
            </div>
            <p className="mt-2 font-[family-name:var(--font-mono)] text-xl font-semibold tabular-nums">
              {profileCount} entries
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Append-only SHA-256 tamper protection
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
              <ShieldCheck className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
              <span>Active Session</span>
            </div>
            <p className="mt-2 text-xl font-semibold">
              {session ? session.role : 'Guest (Sign in)'}
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {session ? session.email : 'RBAC session cookie protected'}
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
