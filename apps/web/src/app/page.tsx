import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Database,
  HeartPulse,
  Languages,
  LineChart,
  Lock,
  Palette,
  ShieldCheck,
  Stethoscope,
  Users,
  Watch,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { CalmFade } from '@/components/motion/primitives';
import { PulseHeroVisual } from '@/components/visuals/pulse-hero';
import { getPool } from '@/db';
import { getSessionContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

const PILLARS = [
  {
    step: '01 · Personal Baseline',
    title: 'Learns your own normal',
    body: 'Weighted median + MAD dispersion across circadian rest, sleep, and activity blocks calibrates each elder over 14 days instead of relying on generic population cutoffs.',
    icon: LineChart,
  },
  {
    step: '02 · Anomaly Detection',
    title: 'Three deterministic layers',
    body: 'Combines L1 safety bounds, L2 directional EWMA/CUSUM & Pelt change-points, and L3 multivariate coherence plus transparent Partial NEWS2 wearable scoring.',
    icon: Activity,
  },
  {
    step: '03 · Early Care Alerts',
    title: 'Anti-fatigue escalation',
    body: 'N-of-M persistence, quiet hours, cooldown deduplication, real-time Caregiver SSE, inbound OK / CALL ME / SNOOZE email replies, and India 112 / 108 routing.',
    icon: BellRing,
  },
  {
    step: '04 · Elder Accessibility',
    title: 'Calm multilingual care',
    body: 'Large 18px+ typography, 48px+ touch controls, Web Speech read-aloud, voice check-in, and medication checks across English, Kannada, and Hindi.',
    icon: Languages,
  },
] as const;

const WORKSPACES = [
  {
    role: 'Patient · Elder Mode',
    route: '/today',
    summary:
      'Daily status in plain words ("changes from your personal normal"), resting HR, SpO2, sleep, steps, one-tap check-in, and immediate caregiver call.',
    icon: HeartPulse,
  },
  {
    role: 'Caregiver Console',
    route: '/caregiver',
    summary:
      'Linked elder profiles, live SSE deterioration updates, step-by-step alert acknowledgement, snooze, escalation, and ambient heat context.',
    icon: Users,
  },
  {
    role: 'Clinician & Audit',
    route: '/clinician',
    summary:
      'Consented cohort triage, zoomed baseline-corridor trajectories, L1/L2/L3 attribution, Partial NEWS2 breakdown, PDF print, and FHIR R4 export.',
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
              <HeartPulse className="h-4 w-4 text-[var(--brand-secondary)]" aria-hidden="true" />
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
              <Stethoscope className="h-4 w-4 text-[var(--brand-secondary)]" aria-hidden="true" />
              <span>Clinician</span>
            </Link>
            <Link
              href="/alerts"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm font-semibold hover:bg-[var(--bg-elevated)]"
            >
              <BellRing className="h-4 w-4 text-[var(--brand-secondary)]" aria-hidden="true" />
              <span>Alerts</span>
            </Link>
            <Link
              href="/ingest"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm font-semibold hover:bg-[var(--bg-elevated)]"
            >
              <Database className="h-4 w-4 text-[var(--brand-secondary)]" aria-hidden="true" />
              <span>Import</span>
            </Link>
            <Link
              href="/design"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm font-semibold hover:bg-[var(--bg-elevated)]"
            >
              <Palette className="h-4 w-4 text-[var(--brand-secondary)]" aria-hidden="true" />
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

      <main className="mx-auto max-w-7xl space-y-10 px-4 py-8 sm:px-6 sm:py-10">
        {/* Hero Section Framed in Exact Sent-Image Aqua-Mint Bento Container */}
        <CalmFade>
          <section className="mint-bento p-5 sm:p-7">
            <div className="grid items-stretch gap-6 lg:grid-cols-12">
              {/* Left Narrative Card */}
              <div className="clinical-card flex flex-col justify-between p-6 sm:p-9 lg:col-span-6">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-[var(--status-stable-bg)] px-3.5 py-1 text-xs font-bold text-[var(--status-stable)]">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Screening &amp; Early Awareness · Non-Diagnostic</span>
                  </div>

                  <h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-4xl">
                    Personal physiological baselines that notice changes before crisis.
                  </h1>
                  <p className="mt-4 text-base text-[var(--text-muted)]">
                    Built for elderly home care and chronic physiological monitoring. SENTINEL learns
                    each individual&apos;s own normal, enforces strict pre-login PHI isolation with
                    PostgreSQL Row-Level Security, and guides caregivers calmly across English,
                    Kannada, and Hindi.
                  </p>
                </div>

                <div className="mt-7 space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      href="/auth"
                      className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-6 text-base font-semibold text-[var(--brand-primary-fg)] transition hover:opacity-95"
                    >
                      <span>
                        {session
                          ? `Signed in as ${session.name} (${session.role})`
                          : 'Sign In / Create Account'}
                      </span>
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                    <Link
                      href="/settings/consent"
                      className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-5 text-base font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-mint-panel)]"
                    >
                      <ShieldCheck className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
                      <span>Open Consent &amp; Audit Ledger</span>
                    </Link>
                  </div>
                  <p className="text-xs text-[var(--text-muted)]">
                    Zero protected patient data is exposed prior to authentication. Create a new
                    account on <code className="font-[family-name:var(--font-mono)]">/auth</code> or
                    sign in with Google to pair your smartwatch.
                  </p>
                </div>
              </div>

              {/* Right Sync Architecture & Restrained Hero Visual */}
              <div className="flex flex-col gap-4 lg:col-span-6">
                <div className="flex items-center justify-between px-1">
                  <span className="font-[family-name:var(--font-display)] text-base font-bold text-[var(--text-primary)]">
                    Universal Smartwatch Ingestion &amp; Privacy
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--status-stable-bg)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--status-stable)]">
                    <Watch className="h-3 w-3" aria-hidden="true" />
                    REAL TELEMETRY READY
                  </span>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="clinical-card p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-[var(--brand-accent-text)]">
                      Direct &amp; Mobile Watch Sync
                    </p>
                    <p className="mt-1 font-[family-name:var(--font-display)] text-base font-bold">
                      Any Watch · Zero Vendor Lock
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      Web Bluetooth BLE 0x180D, Apple Watch Health Auto Export, Android Health
                      Connect, XML &amp; CSV.
                    </p>
                  </div>

                  <div className="clinical-card p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-[var(--brand-accent-text)]">
                      Privacy &amp; Clinical Trace
                    </p>
                    <p className="mt-1 font-[family-name:var(--font-display)] text-base font-bold">
                      DPDP &amp; FHIR R4 Ready
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      AES-256-GCM field encryption, instant consent withdrawal, and SHA-256 audit
                      verification.
                    </p>
                  </div>
                </div>

                {/* Single Restrained Physiological Pulse Visual (max 1 WebGL canvas) */}
                <PulseHeroVisual />
              </div>
            </div>
          </section>
        </CalmFade>

        {/* Four Clinical Pillars */}
        <section aria-label="Core monitoring pillars" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--brand-accent-text)]">
                Four Required Pillars
              </p>
              <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold">
                Built for calm clarity, not alert fatigue
              </h2>
            </div>
            <Link
              href="/model-card"
              className="text-sm font-semibold text-[var(--brand-accent-text)] hover:underline"
            >
              Read Model Card &amp; Limitations →
            </Link>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

        {/* Role Workspaces Bento */}
        <section aria-label="Role workspaces" className="mint-bento p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 px-1">
            <h2 className="font-[family-name:var(--font-display)] text-xl font-bold">
              Role-Tailored Healthcare Workspaces
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
