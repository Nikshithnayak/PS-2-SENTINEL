import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Database,
  HeartPulse,
  Lock,
  Palette,
  ShieldCheck,
  Stethoscope,
  Users,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { CalmFade } from '@/components/motion/primitives';
import { PulseHeroVisual } from '@/components/visuals/pulse-hero';
import { getPool } from '@/db';
import { getSessionContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await getSessionContext();

  let dbConnected = false;
  let auditCount = 0;
  try {
    const res = await getPool().query('SELECT count(*)::int AS cnt FROM audit_logs');
    dbConnected = true;
    auditCount = Number(res.rows[0]?.cnt ?? 0);
  } catch {
    dbConnected = false;
  }

  return (
    <div className="min-h-dvh bg-[var(--bg-base)] text-[var(--text-primary)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/92 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]">
              <Activity className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-[family-name:var(--font-display)] text-lg font-bold leading-tight">
                Sachet · SENTINEL
              </p>
              <p className="text-xs font-medium text-[var(--text-muted)]">
                Wearable Early-Awareness Platform
              </p>
            </div>
          </div>

          <nav aria-label="Primary navigation" className="flex flex-wrap items-center gap-2">
            <Link
              href="/today"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm font-semibold hover:bg-[var(--bg-elevated)]"
            >
              <HeartPulse className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
              <span>Today</span>
            </Link>
            <Link
              href="/caregiver"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm font-semibold hover:bg-[var(--bg-elevated)]"
            >
              <span>Caregiver</span>
            </Link>
            <Link
              href="/clinician"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm font-semibold hover:bg-[var(--bg-elevated)]"
            >
              <Stethoscope className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
              <span>Clinician</span>
            </Link>
            <Link
              href="/alerts"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm font-semibold hover:bg-[var(--bg-elevated)]"
            >
              <BellRing className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
              <span>Alerts</span>
            </Link>
            <Link
              href="/ingest"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm font-semibold hover:bg-[var(--bg-elevated)]"
            >
              <Database className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
              <span>Import</span>
            </Link>
            <Link
              href="/design"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm font-semibold hover:bg-[var(--bg-elevated)]"
            >
              <Palette className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
              <span>Design</span>
            </Link>
            <Link
              href="/auth"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-[var(--brand-primary-fg)] transition hover:opacity-95"
            >
              <span>{session ? session.name : 'Sign In'}</span>
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
        <CalmFade>
          <section className="mint-bento p-5 sm:p-8">
            <div className="clinical-card grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-[1.25fr_1fr]">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-[var(--status-stable-bg)] px-3.5 py-1 text-xs font-bold text-[var(--status-stable)]">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Screening & Early Awareness · Non-Diagnostic</span>
                </div>

                <h1 className="mt-4 max-w-2xl font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight sm:text-4xl">
                  Personal physiological baselines that notice changes before crisis.
                </h1>
                <p className="mt-4 max-w-2xl text-base text-[var(--text-muted)]">
                  Designed for elderly home care and Nitte Pharma Innovation Centre Problem S2.
                  Calibrated to each individual&apos;s own normal with PostgreSQL Row-Level Security,
                  DPDP-aligned consent controls, and calm Kannada, Hindi, and English care workflows.
                </p>

                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <Link
                    href="/auth"
                    className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-6 text-base font-semibold text-[var(--brand-primary-fg)] transition hover:opacity-95"
                  >
                    <span>
                      {session
                        ? `Signed in as ${session.name} (${session.role})`
                        : 'Sign In / Switch Role'}
                    </span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <Link
                    href="/settings/consent"
                    className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-5 text-base font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-mint-panel)]"
                  >
                    <ShieldCheck className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
                    <span>Open Consent & Audit Ledger</span>
                  </Link>
                </div>
              </div>

              <PulseHeroVisual />
            </div>
          </section>
        </CalmFade>

        <section
          aria-label="Live System Verification"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="clinical-card p-5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              <Database className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
              <span>PostgreSQL & RLS</span>
            </div>
            <p className="mt-2 font-[family-name:var(--font-mono)] text-xl font-bold tabular-nums">
              {dbConnected ? 'Connected' : 'Unavailable'}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Partitioned vitals + FORCE RLS active
            </p>
          </div>

          <div className="clinical-card p-5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              <Lock className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
              <span>Hash-Chained Audit</span>
            </div>
            <p className="mt-2 font-[family-name:var(--font-mono)] text-xl font-bold tabular-nums">
              {auditCount} entries
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Append-only SHA-256 tamper protection
            </p>
          </div>

          <div className="clinical-card p-5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              <Users className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
              <span>Active Session</span>
            </div>
            <p className="mt-2 text-xl font-bold capitalize">
              {session ? session.role.replace('_', ' ') : 'Guest (Isolated)'}
            </p>
            <p className="mt-1 truncate text-xs text-[var(--text-muted)]">
              {session ? session.email : 'No PHI exposed before authentication'}
            </p>
          </div>

          <div className="clinical-card p-5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              <ShieldCheck className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
              <span>Emergency Routing</span>
            </div>
            <p className="mt-2 font-[family-name:var(--font-mono)] text-xl font-bold tabular-nums">
              112 / 108
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Urgent escalation + hospital locator ready
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
