'use client';

import { Footprints, TrendingDown, TrendingUp } from 'lucide-react';
import type { VitalsChartPoint } from '@/components/charts/vitals-chart';

interface ActivityRingCardProps {
  points: VitalsChartPoint[];
  medianHourlySteps?: number | null;
  loading?: boolean;
  title?: string;
  subtitle?: string;
  emptyText?: string;
}

export function ActivityRingCard({
  points,
  medianHourlySteps,
  loading = false,
  title = 'Daily Activity & Steps',
  subtitle = 'Walking & Mobility',
  emptyText = 'No step samples recorded in the last 7 days yet.',
}: ActivityRingCardProps) {
  if (loading) {
    return (
      <div
        role="status"
        aria-label="Loading daily activity"
        className="clinical-card h-72 animate-pulse p-6"
      />
    );
  }

  // Group hourly step rollups into latest 24h vs previous 24h using real stored timestamps
  const sorted = [...points].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const latestTs = sorted.length ? new Date(sorted[sorted.length - 1]!.timestamp).getTime() : 0;
  const dayMs = 24 * 3_600_000;
  const recent24h = sorted.filter((p) => latestTs - new Date(p.timestamp).getTime() < dayMs);
  const prev24h = sorted.filter((p) => {
    const diff = latestTs - new Date(p.timestamp).getTime();
    return diff >= dayMs && diff < 2 * dayMs;
  });

  const todaySteps = Math.round(recent24h.reduce((sum, p) => sum + p.value, 0));
  const prevSteps = Math.round(prev24h.reduce((sum, p) => sum + p.value, 0));
  const targetSteps = Math.max(
    1000,
    Math.round((typeof medianHourlySteps === 'number' && medianHourlySteps > 0 ? medianHourlySteps : 250) * 16),
  );
  const pct = sorted.length > 0 ? Math.min(100, Math.round((todaySteps / targetSteps) * 100)) : 0;
  const delta = prev24h.length > 0 ? todaySteps - prevSteps : null;
  const avgConfidence = recent24h.length
    ? Math.round((recent24h.reduce((s, p) => s + p.confidence, 0) / recent24h.length) * 100)
    : null;

  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (pct / 100) * circumference;

  return (
    <article className="clinical-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
            {subtitle}
          </p>
          <h3 className="mt-0.5 font-[family-name:var(--font-display)] text-lg font-bold">
            {title}
          </h3>
        </div>
        {sorted.length > 0 && (
          <span className="rounded-full bg-[var(--bg-mint-panel)] px-3 py-1 text-xs font-bold text-[var(--brand-accent-text)]">
            {pct}% of Baseline
          </span>
        )}
      </div>

      {sorted.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-base)] p-5 text-center text-sm text-[var(--text-muted)]">
          {emptyText}
        </div>
      ) : (
        <>
          <div className="relative my-4 flex items-center justify-center">
            <svg
              className="h-44 w-44 -rotate-90"
              viewBox="0 0 160 160"
              role="img"
              aria-label={`${todaySteps.toLocaleString()} steps in last 24h, ${pct}% of ${targetSteps.toLocaleString()} personal baseline`}
            >
              <defs>
                <linearGradient id="sentinelActivityGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="var(--brand-secondary)" />
                  <stop offset="100%" stopColor="var(--brand-primary)" />
                </linearGradient>
              </defs>
              <circle
                cx="80"
                cy="80"
                r={radius}
                fill="transparent"
                stroke="var(--bg-mint-panel)"
                strokeWidth="14"
              />
              <circle
                cx="80"
                cy="80"
                r={radius}
                fill="transparent"
                stroke="url(#sentinelActivityGrad)"
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <div className="absolute flex flex-col items-center text-center">
              <Footprints className="mb-1 h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
              <span className="font-[family-name:var(--font-mono)] text-2xl font-bold tabular-nums">
                {todaySteps.toLocaleString()}
              </span>
              <span className="text-xs font-medium text-[var(--text-muted)]">
                / {targetSteps.toLocaleString()} normal
              </span>
              {delta !== null && (
                <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-bold text-[var(--brand-accent-text)]">
                  {delta >= 0 ? (
                    <TrendingUp className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <TrendingDown className="h-3 w-3" aria-hidden="true" />
                  )}
                  {delta >= 0 ? '+' : ''}
                  {delta.toLocaleString()} vs prior 24h
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div className="rounded-xl bg-[var(--bg-elevated)] p-3">
              <span className="block font-medium text-[var(--text-muted)]">Active Hours (24h)</span>
              <span className="mt-0.5 block font-[family-name:var(--font-mono)] text-sm font-bold tabular-nums">
                {recent24h.length}h logged
              </span>
            </div>
            <div className="rounded-xl bg-[var(--bg-elevated)] p-3">
              <span className="block font-medium text-[var(--text-muted)]">Signal Confidence</span>
              <span className="mt-0.5 block font-[family-name:var(--font-mono)] text-sm font-bold tabular-nums">
                {avgConfidence !== null ? `${avgConfidence}%` : '—'}
              </span>
            </div>
          </div>
        </>
      )}
    </article>
  );
}
