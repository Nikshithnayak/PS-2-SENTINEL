'use client';

import { Moon } from 'lucide-react';
import type { VitalsChartPoint } from '@/components/charts/vitals-chart';

function formatHoursMinutes(totalMinutes: number): string {
  const mins = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function SleepQualityCard({
  durationPoints,
  efficiencyPoints,
  durationMedian,
  efficiencyMedian,
  loading = false,
  title = 'Sleep Duration & Quality',
  emptyText = 'No sleep summaries recorded in this window yet.',
}: {
  durationPoints: VitalsChartPoint[];
  efficiencyPoints: VitalsChartPoint[];
  durationMedian?: number | null;
  efficiencyMedian?: number | null;
  loading?: boolean;
  title?: string;
  emptyText?: string;
}) {
  if (loading) {
    return (
      <div
        role="status"
        aria-label="Loading sleep quality"
        className="clinical-card h-56 animate-pulse p-6"
      />
    );
  }

  const recentDur = [...durationPoints].slice(-7);
  const latestDur = recentDur.length > 0 ? recentDur[recentDur.length - 1] : null;
  const latestEff =
    efficiencyPoints.length > 0 ? efficiencyPoints[efficiencyPoints.length - 1] : null;

  // Build smooth SVG polyline coordinates from actual duration values
  const vals = recentDur.map((p) => p.value);
  const minV = vals.length ? Math.min(...vals) - 25 : 240;
  const maxV = vals.length ? Math.max(...vals) + 25 : 520;
  const span = Math.max(30, maxV - minV);
  const width = 280;
  const height = 72;

  const coords = recentDur.map((p, i) => {
    const x = recentDur.length <= 1 ? width / 2 : (i / (recentDur.length - 1)) * width;
    const y = height - ((p.value - minV) / span) * (height - 16) - 8;
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)), label: p.timestamp.slice(5, 10) };
  });

  const linePath =
    coords.length > 1
      ? coords.map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ')
      : '';
  const areaPath =
    coords.length > 1
      ? `${linePath} L ${coords[coords.length - 1]!.x} ${height} L ${coords[0]!.x} ${height} Z`
      : '';

  return (
    <article className="clinical-card p-5 sm:p-6">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-mint-panel)] text-[var(--brand-primary)]">
            <Moon className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Rest Assessment
            </p>
            <h3 className="font-[family-name:var(--font-display)] text-lg font-bold">{title}</h3>
          </div>
        </div>
        {latestDur && (
          <span className="rounded-full bg-[var(--bg-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--text-muted)]">
            {latestDur.timestamp.slice(5, 10)}
          </span>
        )}
      </div>

      {!latestDur ? (
        <div className="mt-5 rounded-xl border border-dashed border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 text-center text-sm text-[var(--text-muted)]">
          {emptyText}
        </div>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-[family-name:var(--font-mono)] text-3xl font-bold tabular-nums">
              {formatHoursMinutes(latestDur.value)}
            </span>
            {latestEff && (
              <span className="rounded-full bg-[var(--status-stable-bg)] px-2.5 py-1 text-xs font-bold text-[var(--status-stable)]">
                {Math.round(latestEff.value)}% Efficiency
              </span>
            )}
          </div>

          {coords.length > 1 && (
            <div className="mt-3">
              <svg
                className="h-20 w-full overflow-visible"
                viewBox={`0 0 ${width} ${height}`}
                role="img"
                aria-label={`Sleep duration trend across last ${coords.length} nights`}
              >
                <defs>
                  <linearGradient id="sentinelSleepFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--brand-primary)" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="var(--brand-primary)" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <path d={areaPath} fill="url(#sentinelSleepFill)" />
                <path
                  d={linePath}
                  fill="none"
                  stroke="var(--brand-primary)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {coords.map((c) => (
                  <circle key={c.label} cx={c.x} cy={c.y} r="3" fill="var(--brand-primary)" />
                ))}
              </svg>
              <div className="mt-1 flex justify-between font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-muted)]">
                <span>{coords[0]?.label}</span>
                <span>{coords[coords.length - 1]?.label}</span>
              </div>
            </div>
          )}

          <p className="mt-3 text-xs text-[var(--text-muted)]">
            {typeof durationMedian === 'number'
              ? `Personal normal sleep: ${formatHoursMinutes(durationMedian)}`
              : 'Learning personal sleep normal'}
            {typeof efficiencyMedian === 'number'
              ? ` · Normal efficiency: ${Math.round(efficiencyMedian)}%`
              : ''}
          </p>
        </>
      )}
    </article>
  );
}
