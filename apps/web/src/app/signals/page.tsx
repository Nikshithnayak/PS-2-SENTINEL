'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, LineChart, Trash2 } from 'lucide-react';
import { VitalsChart, type VitalsChartPoint } from '@/components/charts/vitals-chart';
import {
  DetectionTimelineCard,
  type PersistedDetectionTimeline,
} from '@/components/health/detection-timeline-card';
import { SignedOutGate } from '@/components/health/signed-out-gate';
import { SentinelShell } from '@/components/sentinel-shell';

interface SeriesData {
  patientId: string;
  metricType: string;
  baseline: {
    stage: string;
    validDays: number;
    medianVal: number;
    bandLow: number | null;
    bandHigh: number | null;
  } | null;
  points: VitalsChartPoint[];
  recentRawSamples: Array<{
    id: string;
    recordedAt: string;
    value: number;
    unit: string;
    context: string;
    source: string;
    qualityFlags: string[];
    dataConfidence: number;
    isSynthetic: boolean;
  }>;
}

interface ExclusionsResponse {
  excludedPeriods: Array<{
    id: string;
    startAt: string;
    endAt: string;
    reason: string;
    note: string | null;
  }>;
}

export default function SignalExplorerPage() {
  const qc = useQueryClient();
  const [metric, setMetric] = useState('resting_heart_rate');
  const [reason, setReason] = useState('travel');
  const [note, setNote] = useState('Coastal trip / temporary illness period');
  const [msg, setMsg] = useState<string | null>(null);

  const seriesQuery = useQuery<SeriesData>({
    queryKey: ['vitals-series-explorer', metric],
    queryFn: async () => {
      const res = await fetch(`/api/v1/vitals/series?metric=${metric}&window=30d`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const exclusionsQuery = useQuery<ExclusionsResponse>({
    queryKey: ['exclusions'],
    enabled: !seriesQuery.isError,
    queryFn: async () => {
      const res = await fetch('/api/v1/exclusions');
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const dashboardQuery = useQuery<{
    isSynthetic?: boolean;
    detectionTimeline?: PersistedDetectionTimeline | null;
  }>({
    queryKey: ['signals-detection-timeline'],
    enabled: !seriesQuery.isError,
    queryFn: async () => {
      const res = await fetch('/api/v1/dashboard/patient');
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const addExclusionMutation = useMutation({
    mutationFn: async () => {
      const now = Date.now();
      const res = await fetch('/api/v1/exclusions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          startAt: new Date(now - 36 * 3_600_000).toISOString(),
          endAt: new Date(now - 12 * 3_600_000).toISOString(),
          reason,
          note,
        }),
      });
      if (!res.ok) throw new Error('Failed to create exclusion period');
      return res.json();
    },
    onSuccess: () => {
      setMsg('Quarantine window saved. Baseline learning excludes this period.');
      qc.invalidateQueries({ queryKey: ['exclusions'] });
    },
  });

  const deleteExclusionMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/exclusions?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['exclusions'] });
    },
  });

  function onAddExclusion(e: FormEvent) {
    e.preventDefault();
    addExclusionMutation.mutate();
  }

  const isUnauth = seriesQuery.error?.message === '401';
  const hasSynthetic = (seriesQuery.data?.recentRawSamples ?? []).some((s) => s.isSynthetic);

  return (
    <SentinelShell
      title="Health Trends & Quarantine"
      subtitle="30-day longitudinal telemetry, personal normal corridors & contamination exclusions"
      isSynthetic={hasSynthetic}
    >
      <main className="space-y-6">
        {isUnauth ? (
          <SignedOutGate heading="Sign in to explore raw telemetry" />
        ) : (
          <>
            {msg && (
              <div
                role="status"
                className="rounded-xl border border-[var(--status-stable)] bg-[var(--status-stable-bg)] px-4 py-3 text-sm font-medium text-[var(--status-stable)]"
              >
                {msg}
              </div>
            )}

            <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <LineChart className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                  <h2 className="text-lg font-semibold">30-Day Signal & Quality Explorer</h2>
                </div>
                <select
                  aria-label="Signal metric"
                  value={metric}
                  onChange={(e) => setMetric(e.target.value)}
                  className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm font-semibold"
                >
                  <option value="resting_heart_rate">resting_heart_rate</option>
                  <option value="hrv_rmssd">hrv_rmssd</option>
                  <option value="spo2">spo2</option>
                  <option value="respiratory_rate">respiratory_rate</option>
                  <option value="skin_temp_deviation">skin_temp_deviation</option>
                  <option value="steps">steps</option>
                  <option value="sleep_duration_min">sleep_duration_min</option>
                  <option value="sleep_efficiency">sleep_efficiency</option>
                </select>
              </div>

              <div className="mt-4">
                <VitalsChart
                  title={metric}
                  unit=""
                  points={seriesQuery.data?.points ?? []}
                  bandLow={seriesQuery.data?.baseline?.bandLow}
                  bandHigh={seriesQuery.data?.baseline?.bandHigh}
                  medianVal={seriesQuery.data?.baseline?.medianVal}
                  loading={seriesQuery.isLoading}
                  baselineStage={seriesQuery.data?.baseline?.stage}
                  validDays={seriesQuery.data?.baseline?.validDays}
                />
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
                <div className="flex items-center gap-2">
                  <CalendarOff className="h-5 w-5 text-[var(--status-watch)]" aria-hidden="true" />
                  <h2 className="text-lg font-semibold">Baseline Contamination Quarantine</h2>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Mark hospital stays, acute illness, or travel windows so personal baselines never
                  learn abnormal periods as healthy normal.
                </p>

                <form onSubmit={onAddExclusion} className="mt-4 flex flex-wrap gap-2">
                  <select
                    aria-label="Exclusion reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm"
                  >
                    <option value="illness">Acute Illness</option>
                    <option value="hospital">Hospital Stay</option>
                    <option value="travel">Travel</option>
                    <option value="device_swap">Device Swap</option>
                    <option value="medication_change">Medication Change</option>
                  </select>
                  <input
                    aria-label="Quarantine note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm"
                  />
                  <button
                    type="submit"
                    className="min-h-11 rounded-lg bg-[var(--brand-primary)] px-4 text-sm font-semibold text-[var(--brand-primary-fg)] cursor-pointer"
                  >
                    Quarantine Last 24h
                  </button>
                </form>

                <ul className="mt-4 space-y-2 text-xs">
                  {(exclusionsQuery.data?.excludedPeriods ?? []).map((ex) => (
                    <li
                      key={ex.id}
                      className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] p-2.5"
                    >
                      <span>
                        <strong className="uppercase">{ex.reason}</strong> · {ex.note ?? 'Excluded window'}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteExclusionMutation.mutate(ex.id)}
                        aria-label="Remove quarantine window"
                        className="min-h-9 rounded p-1.5 text-[var(--status-urgent)] hover:bg-[var(--status-urgent-bg)] cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
                <h2 className="text-lg font-semibold">Recent Raw Samples & Quality Flags</h2>
                <div
                  tabIndex={0}
                  role="region"
                  aria-label="Recent raw wearable samples"
                  className="mt-3 max-h-72 overflow-auto"
                >
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                        <th className="py-1.5 pr-2">Timestamp</th>
                        <th className="py-1.5 pr-2">Value</th>
                        <th className="py-1.5 pr-2">Context</th>
                        <th className="py-1.5 pr-2">Confidence</th>
                        <th className="py-1.5">Flags</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)] font-[family-name:var(--font-mono)]">
                      {(seriesQuery.data?.recentRawSamples ?? []).slice(0, 20).map((s) => (
                        <tr key={s.id}>
                          <td className="py-1.5 pr-2">{s.recordedAt.slice(0, 16).replace('T', ' ')}</td>
                          <td className="py-1.5 pr-2">
                            {s.value} {s.unit}
                          </td>
                          <td className="py-1.5 pr-2">{s.context}</td>
                          <td className="py-1.5 pr-2">{s.dataConfidence}</td>
                          <td className="py-1.5">{s.qualityFlags.join(', ') || 'ok'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <DetectionTimelineCard
              timeline={dashboardQuery.data?.detectionTimeline}
              isSynthetic={hasSynthetic || dashboardQuery.data?.isSynthetic}
            />
          </>
        )}
      </main>
    </SentinelShell>
  );
}
