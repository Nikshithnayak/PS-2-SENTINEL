'use client';

import { Activity, HeartPulse, MoonStar, Footprints } from 'lucide-react';

export function PulseHeroVisual() {
  return (
    <div
      aria-label="Example daily health overview"
      className="clinical-card overflow-hidden"
      data-testid="pulse-static-fallback"
    >
      <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Today</p>
          <p className="mt-0.5 font-[family-name:var(--font-display)] text-xl font-bold">Health overview</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--status-stable-bg)] px-3 py-1.5 text-xs font-bold text-[var(--status-stable)]">
          <Activity className="h-3.5 w-3.5" aria-hidden="true" />
          Steady
        </span>
      </div>
      <div className="grid grid-cols-2 gap-px bg-[var(--border-subtle)] sm:grid-cols-4">
        {[
          { label: 'Resting heart rate', value: '68', unit: 'bpm', icon: HeartPulse },
          { label: 'SpO₂', value: '98', unit: '%', icon: Activity },
          { label: 'Sleep', value: '7h 12m', unit: '', icon: MoonStar },
          { label: 'Steps', value: '4,280', unit: 'today', icon: Footprints },
        ].map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className="min-w-0 bg-[var(--bg-surface)] p-4 sm:p-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
                <Icon className="h-4 w-4 shrink-0 text-[var(--brand-primary)]" aria-hidden="true" />
                <span className="truncate">{metric.label}</span>
              </div>
              <p className="mt-3 font-[family-name:var(--font-mono)] text-2xl font-bold tabular-nums">
                {metric.value}
              </p>
              {metric.unit && (
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">{metric.unit}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
