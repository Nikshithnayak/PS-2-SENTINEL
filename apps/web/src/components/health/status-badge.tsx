'use client';

import { AlertTriangle, CheckCircle2, Eye, FlaskConical, Siren } from 'lucide-react';

export type DeteriorationLevel = 'stable' | 'watch' | 'warning' | 'urgent';

const STATUS_CONFIG: Record<
  DeteriorationLevel,
  {
    label: string;
    Icon: typeof CheckCircle2;
    fgVar: string;
    bgVar: string;
  }
> = {
  stable: {
    label: 'Stable',
    Icon: CheckCircle2,
    fgVar: '--status-stable',
    bgVar: '--status-stable-bg',
  },
  watch: {
    label: 'Watch',
    Icon: Eye,
    fgVar: '--status-watch',
    bgVar: '--status-watch-bg',
  },
  warning: {
    label: 'Warning',
    Icon: AlertTriangle,
    fgVar: '--status-warning',
    bgVar: '--status-warning-bg',
  },
  urgent: {
    label: 'Urgent',
    Icon: Siren,
    fgVar: '--status-urgent',
    bgVar: '--status-urgent-bg',
  },
};

export function normalizeLevel(level?: string | null): DeteriorationLevel {
  if (level === 'watch' || level === 'warning' || level === 'urgent') return level;
  return 'stable';
}

export function StatusBadge({
  level,
  labelOverride,
  size = 'sm',
}: {
  level?: string | null;
  labelOverride?: string;
  size?: 'sm' | 'md';
}) {
  const cfg = STATUS_CONFIG[normalizeLevel(level)];
  const Icon = cfg.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${
        size === 'md' ? 'px-3.5 py-1.5 text-sm' : 'px-2.5 py-0.5 text-xs'
      }`}
      style={{
        backgroundColor: `var(${cfg.bgVar})`,
        color: `var(${cfg.fgVar})`,
      }}
    >
      <Icon className={size === 'md' ? 'h-4 w-4 shrink-0' : 'h-3.5 w-3.5 shrink-0'} aria-hidden="true" />
      <span>{labelOverride ?? cfg.label}</span>
    </span>
  );
}

export function SyntheticBadge() {
  return (
    <span
      data-testid="global-synthetic-badge"
      className="inline-flex items-center gap-1 rounded-full bg-[var(--status-synthetic-bg)] px-2.5 py-1 text-xs font-bold text-[var(--status-synthetic)]"
    >
      <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>SYNTHETIC</span>
    </span>
  );
}
