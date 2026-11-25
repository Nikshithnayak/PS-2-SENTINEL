import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  FlaskConical,
  Siren,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

const STATUS_TOKENS = [
  {
    name: 'Stable',
    icon: CheckCircle2,
    colorVar: '--status-stable',
    bgVar: '--status-stable-bg',
    note: 'Within personal baseline range',
  },
  {
    name: 'Watch',
    icon: Eye,
    colorVar: '--status-watch',
    bgVar: '--status-watch-bg',
    note: 'Early drift observed — continue normal wear',
  },
  {
    name: 'Warning',
    icon: AlertTriangle,
    colorVar: '--status-warning',
    bgVar: '--status-warning-bg',
    note: 'Sustained shift across 2+ signals — caregiver notified',
  },
  {
    name: 'Urgent',
    icon: Siren,
    colorVar: '--status-urgent',
    bgVar: '--status-urgent-bg',
    note: 'Immediate escalation + 112 / 108 emergency path',
  },
  {
    name: 'SYNTHETIC',
    icon: FlaskConical,
    colorVar: '--status-synthetic',
    bgVar: '--status-synthetic-bg',
    note: 'Explicitly separates simulated evaluation telemetry',
  },
] as const;

export default function DesignSystemPage() {
  return (
    <div className="min-h-dvh bg-[var(--bg-base)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Back to Home</span>
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-10">
        <section>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-semibold">
            Sachet · SENTINEL Design Contract
          </h1>
          <p className="mt-2 max-w-2xl text-base text-[var(--text-muted)]">
            Grounded in WCAG 2.2 AA contrast, Atkinson Hyperlegible body text, Fraunces editorial
            display headings, and JetBrains Mono tabular telemetry.
          </p>
        </section>

        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
          <h2 className="text-lg font-semibold">Semantic Status Badges (Icon + Word, Never Color Alone)</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {STATUS_TOKENS.map((token) => {
              const Icon = token.icon;
              return (
                <div
                  key={token.name}
                  className="rounded-xl border border-[var(--border-subtle)] p-4"
                  style={{ backgroundColor: `var(${token.bgVar})` }}
                >
                  <div
                    className="inline-flex items-center gap-2 text-base font-bold"
                    style={{ color: `var(${token.colorVar})` }}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    <span>{token.name}</span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--text-primary)]">{token.note}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
          <h2 className="text-lg font-semibold">Elder Mode Typography & Touch Target Minimums</h2>
          <div className="mt-4 space-y-4">
            <p className="elder-text">
              Body floor (18px Atkinson Hyperlegible): Your resting heart rate and breathing stayed
              within your normal range today. (Kannada: ನಿಮ್ಮ ಆರೋಗ್ಯ ಸ್ಥಿರವಾಗಿದೆ · Hindi: आज आपकी
              धड़कन सामान्य है)
            </p>
            <div className="flex flex-wrap items-center gap-4 font-[family-name:var(--font-mono)] text-2xl font-semibold tabular-nums">
              <span>68 bpm</span>
              <span>97 % SpO₂</span>
              <span>36.7 °C</span>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="elder-target rounded-xl bg-[var(--brand-primary)] px-6 py-3 text-base font-semibold text-[var(--brand-primary-fg)] cursor-pointer"
              >
                48px+ Primary Elder Touch Target
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
