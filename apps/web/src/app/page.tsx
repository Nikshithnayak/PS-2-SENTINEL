import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BellRing,
  Database,
  HeartPulse,
  LineChart,
  Lock,
  ShieldCheck,
  Stethoscope,
  Users,
} from 'lucide-react';
import { CalmFade } from '@/components/motion/primitives';
import { PulseHeroVisual } from '@/components/visuals/pulse-hero';
import { getPool } from '@/db';
import { getSessionContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

const PILLARS = [
  {
    step: '01',
    title: 'Learn a personal baseline',
    body: 'SENTINEL builds a normal range from rest, sleep, heart rate, and activity over 14 days.',
    icon: LineChart,
  },
  {
    step: '02',
    title: 'Notice meaningful changes',
    body: 'A change is assessed across several signals rather than from a single isolated reading.',
    icon: Activity,
  },
  {
    step: '03',
    title: 'Inform the right people',
    body: 'The patient, caregiver, or clinician receives clear next steps with calm escalation.',
    icon: BellRing,
  },
] as const;

const WORKSPACES = [
  {
    role: 'Patient · Elder Mode',
    route: '/today',
    summary: 'A daily status, important readings, medication checks, and direct help.',
    icon: HeartPulse,
  },
  {
    role: 'Caregiver Console',
    route: '/caregiver',
    summary: 'One place to review linked elders, acknowledge alerts, and respond.',
    icon: Users,
  },
  {
    role: 'Clinician & Audit',
    route: '/clinician',
    summary: 'Consented cohort review, trends, assessment details, and report export.',
    icon: Stethoscope,
  },
] as const;

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
      {/* Top Healthcare Utility Header matching glacial aqua-mint palette */}
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/95 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
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

          <nav
            aria-label="Primary navigation"
            className="flex min-w-0 max-w-[70%] items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:max-w-none sm:flex-wrap sm:overflow-visible"
          >
            <Link
              href="/today"
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm font-semibold hover:bg-[var(--bg-elevated)]"
            >
              <HeartPulse className="h-4 w-4 text-[var(--brand-secondary)]" aria-hidden="true" />
              <span>Today</span>
            </Link>
            <Link
              href="/alerts"
              className="hidden min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm font-semibold hover:bg-[var(--bg-elevated)] sm:inline-flex"
            >
              <BellRing className="h-4 w-4 text-[var(--brand-secondary)]" aria-hidden="true" />
              <span>Alerts</span>
            </Link>
            <Link
              href="/auth"
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-[var(--brand-primary-fg)] transition hover:opacity-95"
            >
              <span>{session ? session.name : 'Sign In'}</span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-10 px-4 py-8 sm:px-6 sm:py-10">
        {/* Concise home overview */}
        <CalmFade>
          <section className="grid items-center gap-8 border-y border-[var(--border-subtle)] py-8 sm:py-10 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.95fr)]">
            <div className="max-w-2xl">
              <p className="text-sm font-bold uppercase tracking-[0.16em] text-[var(--brand-accent-text)]">
                Wearable early awareness
              </p>
              <h1 className="mt-4 max-w-xl font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl">
                Notice when daily health starts to change.
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-[var(--text-muted)]">
                SENTINEL compares heart rate, sleep, activity, and other readings with an individual&apos;s own baseline, then shows only changes that may need attention.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/today"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-5 text-base font-semibold text-[var(--brand-primary-fg)]"
                >
                  Open today&apos;s view
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/model-card"
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 text-base font-semibold"
                >
                  How it works
                </Link>
              </div>
              <p className="mt-4 text-sm text-[var(--text-muted)]">
                Screening and early awareness only. Not a diagnostic medical device.
              </p>
            </div>

            <PulseHeroVisual />
          </section>
        </CalmFade>

        {/* How it works */}
        <section aria-label="Core monitoring pillars" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold">
                How SENTINEL works
              </h2>
            </div>
            <Link
              href="/model-card"
              className="text-sm font-semibold text-[var(--brand-accent-text)] hover:underline"
            >
              Read the model card →
            </Link>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {PILLARS.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.step} className="clinical-card p-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded-full bg-[var(--bg-elevated)] px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-[11px] font-semibold text-[var(--brand-accent-text)]">
                      {item.step}
                    </span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--bg-mint-panel)] text-[var(--brand-primary)]">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </div>
                  <h3 className="mt-3 font-[family-name:var(--font-display)] text-lg font-bold">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-sm text-[var(--text-muted)]">{item.body}</p>
                </article>
              );
            })}
          </div>
        </section>

        {/* Role workspaces */}
        <section aria-label="Role workspaces" className="border-y border-[var(--border-subtle)] py-8">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 className="font-[family-name:var(--font-display)] text-xl font-bold">
              Choose your workspace
            </h2>
            <Link
              href="/auth"
              className="text-sm font-semibold text-[var(--brand-accent-text)] hover:underline"
            >
              Choose role on Sign In →
            </Link>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {WORKSPACES.map((ws) => {
              const Icon = ws.icon;
              return (
                <Link
                  key={ws.route}
                  href={ws.route}
                  className="clinical-card flex flex-col justify-between p-5 transition hover:border-[var(--brand-primary)]"
                >
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]">
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <h3 className="font-[family-name:var(--font-display)] text-lg font-bold">
                        {ws.role}
                      </h3>
                    </div>
                    <p className="mt-3 text-sm text-[var(--text-muted)]">{ws.summary}</p>
                  </div>
                  <p className="mt-4 inline-flex items-center gap-1 font-[family-name:var(--font-mono)] text-xs font-bold text-[var(--brand-accent-text)]">
                    <span>Open {ws.route}</span>
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </p>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Live System Verification Strip */}
        <section
          aria-label="Live System Verification"
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <div className="clinical-card p-5">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              <Database className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
              <span>PostgreSQL &amp; RLS</span>
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

      <footer className="border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-5 text-xs text-[var(--text-muted)] sm:px-6">
          <p>
            Early health-awareness companion — not a diagnostic medical device. Emergency India
            default: 112 / 108.
          </p>
          <div className="flex flex-wrap gap-4 font-semibold text-[var(--brand-accent-text)]">
            <Link href="/model-card" className="hover:underline">
              Model Card
            </Link>
            <Link href="/design" className="hover:underline">
              Design Tokens
            </Link>
            <Link href="/settings/consent" className="hover:underline">
              Consent Ledger
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
