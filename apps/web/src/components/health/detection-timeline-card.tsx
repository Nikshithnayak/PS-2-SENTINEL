'use client';

import { Activity, AlertTriangle, CheckCircle2, Clock3, ShieldCheck } from 'lucide-react';
import { StatusBadge } from '@/components/health/status-badge';

export interface DetectionTimelineEvent {
  timestamp: string;
  stage: 'baseline' | 'first_detection' | 'confirmed_alert' | 'monitoring' | 'recovered';
  level: string;
  index: number;
  metric: string;
  layers: string[];
  reason: string;
  alertStatus?: string;
}

export interface PersistedDetectionTimeline {
  phase: 'baseline_only' | 'first_detection' | 'confirmed_alert' | 'recovered';
  firstDetectionAt: string | null;
  firstDetectionMetric: string | null;
  contributingLayers: string[];
  firstDetectionReason: string | null;
  confirmedAlertAt: string | null;
  confirmedAlertLevel: string | null;
  recoveredAt: string | null;
  latestIndex: number;
  latestLevel: string;
  events: DetectionTimelineEvent[];
}

interface DetectionTimelineCardProps {
  timeline?: PersistedDetectionTimeline | null;
  isSynthetic?: boolean;
  title?: string;
  compact?: boolean;
}

const PHASE_COPY: Record<
  PersistedDetectionTimeline['phase'],
  { label: string; toneClass: string }
> = {
  baseline_only: {
    label: 'Within Personal Normal',
    toneClass: 'border-[var(--status-stable)] bg-[var(--status-stable-bg)] text-[var(--status-stable)]',
  },
  first_detection: {
    label: 'First Early Shift Noticed',
    toneClass: 'border-[var(--status-watch)] bg-[var(--status-watch-bg)] text-[var(--status-watch)]',
  },
  confirmed_alert: {
    label: 'Confirmed Sustained Change',
    toneClass: 'border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] text-[var(--status-urgent)]',
  },
  recovered: {
    label: 'Returned Toward Personal Normal',
    toneClass: 'border-[var(--status-stable)] bg-[var(--status-stable-bg)] text-[var(--status-stable)]',
  },
};

const STAGE_LABEL: Record<DetectionTimelineEvent['stage'], string> = {
  baseline: 'Personal Normal Established',
  first_detection: 'First Qualifying Detection',
  confirmed_alert: 'Confirmed Alert Dispatch',
  monitoring: 'Follow-Up Observation',
  recovered: 'Recovered Toward Baseline',
};

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return 'Not recorded yet';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export function DetectionTimelineCard({
  timeline,
  isSynthetic = false,
  title = 'First-Detection & Recovery Timeline',
  compact = false,
}: DetectionTimelineCardProps) {
  if (!timeline) {
    return (
      <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
        <div className="flex items-center gap-2">
          <Clock3 className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
          <h2 className="font-[family-name:var(--font-display)] text-lg font-bold">{title}</h2>
        </div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          No persisted evaluations yet. Sync wearable readings or run evaluation to record the
          baseline-to-detection audit timeline.
        </p>
      </section>
    );
  }

  const phaseMeta = PHASE_COPY[timeline.phase];

  return (
    <section
      data-testid="detection-timeline-card"
      className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Clock3 className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
          <h2 className="font-[family-name:var(--font-display)] text-lg font-bold">{title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isSynthetic && (
            <span className="rounded-full border border-amber-400/60 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              Synthetic Demonstration Data
            </span>
          )}
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold ${phaseMeta.toneClass}`}
          >
            {phaseMeta.label}
          </span>
        </div>
      </div>

      <p className="mt-1.5 text-xs text-[var(--text-muted)]">
        Derived strictly from persisted assessment logs, N-of-M alert confirmations, and recovery
        evaluations — SENTINEL surfaces physiological changes for human review and never diagnoses disease.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            First Qualifying Detection
          </span>
          <p
            data-testid="first-detection-time"
            className="mt-1 font-[family-name:var(--font-mono)] text-xs font-bold text-[var(--text-primary)]"
          >
            {fmtTime(timeline.firstDetectionAt)}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            {timeline.firstDetectionMetric
              ? `Primary shift: ${timeline.firstDetectionMetric}`
              : 'All tracked readings remained in personal normal corridor.'}
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Contributing Layers
          </span>
          <p className="mt-1 text-xs font-semibold text-[var(--text-primary)]">
            {timeline.contributingLayers.length > 0
              ? timeline.contributingLayers.join(' · ')
              : 'None active yet'}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--text-muted)]">
            {timeline.firstDetectionReason ?? 'L1 bounds, L2 temporal Z/EWMA/CUSUM & L3 multivariate quiet.'}
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Confirmed Alert Gate
          </span>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-xs font-bold text-[var(--text-primary)]">
            {timeline.confirmedAlertAt ? fmtTime(timeline.confirmedAlertAt) : 'Not triggered'}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            {timeline.confirmedAlertLevel
              ? `Confirmed via N-of-M rule (${timeline.confirmedAlertLevel})`
              : 'Requires repeated readings (2-of-3) or immediate L1 urgency.'}
          </p>
        </div>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Return Toward Baseline
          </span>
          <p className="mt-1 font-[family-name:var(--font-mono)] text-xs font-bold text-[var(--text-primary)]">
            {timeline.recoveredAt
              ? fmtTime(timeline.recoveredAt)
              : timeline.phase === 'baseline_only'
                ? 'Steady inside baseline'
                : 'Ongoing follow-up'}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            Latest persisted index: {timeline.latestIndex} ({timeline.latestLevel})
          </p>
        </div>
      </div>

      {!compact && timeline.events.length > 0 && (
        <ol className="mt-4 space-y-2 border-l-2 border-[var(--border-subtle)] pl-4">
          {timeline.events.slice(-8).map((ev, idx) => (
            <li
              key={`${ev.timestamp}-${ev.stage}-${idx}`}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-semibold">
                  {ev.stage === 'recovered' || ev.stage === 'baseline' ? (
                    <CheckCircle2 className="h-4 w-4 text-[var(--status-stable)]" aria-hidden="true" />
                  ) : ev.stage === 'confirmed_alert' ? (
                    <AlertTriangle className="h-4 w-4 text-[var(--status-urgent)]" aria-hidden="true" />
                  ) : ev.stage === 'first_detection' ? (
                    <Activity className="h-4 w-4 text-[var(--status-watch)]" aria-hidden="true" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
                  )}
                  <span>{STAGE_LABEL[ev.stage]}</span>
                  <StatusBadge level={ev.level} />
                </div>
                <span className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-muted)]">
                  {fmtTime(ev.timestamp)} · Index {ev.index}
                </span>
              </div>
              <p className="mt-1 text-[var(--text-primary)]">{ev.reason}</p>
              <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-[var(--text-muted)]">
                <span>Metric: {ev.metric}</span>
                {ev.layers.length > 0 && <span>Layers: {ev.layers.join(', ')}</span>}
                {ev.alertStatus && <span>Alert Status: {ev.alertStatus}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
