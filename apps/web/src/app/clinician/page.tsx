'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BellRing, Printer, ShieldAlert, Stethoscope, Users } from 'lucide-react';
import { VitalsChart, type VitalsChartPoint } from '@/components/charts/vitals-chart';
import { SignedOutGate } from '@/components/health/signed-out-gate';
import { StatusBadge, SyntheticBadge } from '@/components/health/status-badge';
import { SentinelShell } from '@/components/sentinel-shell';

interface CohortRow {
  patientId: string;
  displayCode: string;
  patientName: string;
  ageBand: string;
  conditionModules: string[];
  deteriorationIndex: number;
  level: string;
  baselineStage: string;
  validDays: number;
  openAlertCount: number;
  isSynthetic: boolean;
}

interface PatientOverview {
  patientId: string;
  patientName: string;
  conditionModules: string[];
  isSynthetic: boolean;
  latestAssessment: {
    deteriorationIndex: number;
    level: string;
    l1Score: number;
    l2Score: number;
    l3Score: number;
    partialNews2: {
      partialScore: number;
      maxObservablePoints: number;
      scoredParameterCount: number;
      totalNews2Parameters: number;
      spo2Scale: number;
      disclaimer: string;
      parameters: Array<{
        parameter: string;
        observedValue: number | null;
        points: number | null;
        status: string;
        rule: string;
      }>;
    } | null;
    contributions: Array<{
      metricType: string;
      label: string;
      observed: number;
      normalLow: number;
      normalHigh: number;
      unit: string;
      sharePct: number;
      message: string;
    }>;
    explanationEn: string;
  } | null;
  alerts?: Array<{
    id: string;
    level: string;
    status: string;
    escalationStep: number;
    summaryEn: string;
    createdAt: string;
  }>;
}

interface VitalsSeriesPayload {
  metricType: string;
  window: '24h' | '7d' | '30d';
  baseline: {
    stage: string;
    validDays: number;
    medianVal: number;
    bandLow: number | null;
    bandHigh: number | null;
  } | null;
  comparison: {
    currentMean: number | null;
    previousWindowMean: number | null;
  };
  points: VitalsChartPoint[];
  changePoints: string[];
  alertMarkers: Array<{ timestamp: string }>;
  medMarkers: Array<{ timestamp: string; medName: string; status: string }>;
}

const METRICS = [
  { id: 'resting_heart_rate', label: 'Resting HR', unit: 'bpm' },
  { id: 'hrv_rmssd', label: 'HRV (RMSSD)', unit: 'ms' },
  { id: 'spo2', label: 'SpO₂', unit: '%' },
  { id: 'respiratory_rate', label: 'Respiratory Rate', unit: '/min' },
  { id: 'skin_temp_deviation', label: 'Skin Temp Δ', unit: '°C' },
  { id: 'steps', label: 'Steps', unit: 'count' },
  { id: 'sleep_duration_min', label: 'Sleep Duration', unit: 'min' },
  { id: 'sleep_efficiency', label: 'Sleep Efficiency', unit: '%' },
] as const;

export default function ClinicianDashboardPage() {
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [metric, setMetric] = useState<string>('resting_heart_rate');
  const [windowSpan, setWindowSpan] = useState<'24h' | '7d' | '30d'>('7d');

  const cohortQuery = useQuery<{ cohort: CohortRow[] }>({
    queryKey: ['clinician-cohort'],
    queryFn: async () => {
      const res = await fetch('/api/v1/clinician/cohort');
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const activePatientId = selectedPatientId ?? cohortQuery.data?.cohort[0]?.patientId ?? null;

  const overviewQuery = useQuery<PatientOverview>({
    queryKey: ['dashboard-patient', activePatientId],
    enabled: Boolean(activePatientId),
    queryFn: async () => {
      const res = await fetch(`/api/v1/dashboard/patient?patientId=${activePatientId}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const seriesQuery = useQuery<VitalsSeriesPayload>({
    queryKey: ['vitals-series', activePatientId, metric, windowSpan],
    enabled: Boolean(activePatientId),
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/vitals/series?patientId=${activePatientId}&metric=${metric}&window=${windowSpan}`,
      );
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const isUnauth = cohortQuery.error?.message === '401';
  const metricMeta = METRICS.find((m) => m.id === metric) ?? METRICS[0];
  const curMean = seriesQuery.data?.comparison.currentMean;
  const prevMean = seriesQuery.data?.comparison.previousWindowMean;
  const delta =
    typeof curMean === 'number' && typeof prevMean === 'number'
      ? Number((curMean - prevMean).toFixed(2))
      : null;

  return (
    <SentinelShell
      title="Clinician Triage & Deep-Dive"
      subtitle="Consented cohort ranking, personal baseline corridors & transparent Partial NEWS2"
      isSynthetic={overviewQuery.data?.isSynthetic}
      rightSlot={
        <Link
          href="/clinician/report"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[var(--brand-primary)] px-3.5 text-xs font-semibold text-[var(--brand-primary-fg)] transition hover:opacity-95"
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
          <span>PDF / FHIR</span>
        </Link>
      }
    >
      <main className="space-y-6">
        {isUnauth ? (
          <SignedOutGate heading="Sign in to open Clinician View" />
        ) : (
          <>
            {/* Consented Cohort Triage Table inside Mint Bento Frame */}
            <section className="mint-bento p-4 sm:p-5">
              <div className="clinical-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                    <h2 className="font-[family-name:var(--font-display)] text-lg font-bold">
                      Consented Patient Cohort (Triage Ranked)
                    </h2>
                  </div>
                  <span className="text-xs font-semibold text-[var(--text-muted)]">
                    {(cohortQuery.data?.cohort ?? []).length} consented patient(s)
                  </span>
                </div>

                <div
                  tabIndex={0}
                  role="region"
                  aria-label="Consented patient cohort table"
                  className="mt-3 overflow-x-auto"
                >
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
                        <th className="py-2.5 pr-3">Patient</th>
                        <th className="py-2.5 pr-3">Conditions</th>
                        <th className="py-2.5 pr-3">Index</th>
                        <th className="py-2.5 pr-3">Status</th>
                        <th className="py-2.5 pr-3">Baseline</th>
                        <th className="py-2.5 pr-3">Open Alerts</th>
                        <th className="py-2.5">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {(cohortQuery.data?.cohort ?? []).map((row) => (
                        <tr
                          key={row.patientId}
                          className={
                            row.patientId === activePatientId ? 'bg-[var(--bg-elevated)]' : ''
                          }
                        >
                          <td className="py-3 pr-3 font-semibold">
                            <button
                              type="button"
                              onClick={() => setSelectedPatientId(row.patientId)}
                              className="text-left underline hover:text-[var(--brand-accent-text)] cursor-pointer"
                            >
                              {row.patientName} ({row.ageBand})
                            </button>
                          </td>
                          <td className="py-3 pr-3">{row.conditionModules.join(', ')}</td>
                          <td className="py-3 pr-3 font-[family-name:var(--font-mono)] font-bold tabular-nums">
                            {row.deteriorationIndex}
                          </td>
                          <td className="py-3 pr-3">
                            <StatusBadge level={row.level} />
                          </td>
                          <td className="py-3 pr-3">
                            {row.baselineStage} ({row.validDays}d)
                          </td>
                          <td className="py-3 pr-3 font-[family-name:var(--font-mono)] tabular-nums">
                            {row.openAlertCount}
                          </td>
                          <td className="py-3">
                            {row.isSynthetic ? (
                              <SyntheticBadge />
                            ) : (
                              <span className="text-xs font-medium text-[var(--text-muted)]">Real</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* Physiological Chart + Anomaly Explanation & Alert History Split */}
            <div className="grid gap-6 xl:grid-cols-12">
              <section className="mint-bento p-4 sm:p-5 xl:col-span-8">
                <div className="clinical-card p-5 sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Stethoscope className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                      <h2 className="font-[family-name:var(--font-display)] text-lg font-bold">
                        {overviewQuery.data?.patientName ?? 'Patient'} — {metricMeta.label} Trajectory
                      </h2>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <div className="flex rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-0.5">
                        {(['24h', '7d', '30d'] as const).map((w) => (
                          <button
                            key={w}
                            type="button"
                            onClick={() => setWindowSpan(w)}
                            className={`min-h-9 rounded-lg px-3 text-xs font-semibold cursor-pointer ${
                              windowSpan === w
                                ? 'bg-[var(--brand-rail-active)] text-[var(--brand-rail-active-fg)]'
                                : ''
                            }`}
                          >
                            {w}
                          </button>
                        ))}
                      </div>
                      <select
                        aria-label="Clinical metric selector"
                        value={metric}
                        onChange={(e) => setMetric(e.target.value)}
                        className="min-h-10 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-xs font-semibold"
                      >
                        {METRICS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label} ({m.unit})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs">
                      <span className="text-[var(--text-muted)]">Current {windowSpan} Mean</span>
                      <p className="mt-1 font-[family-name:var(--font-mono)] text-base font-bold tabular-nums">
                        {curMean !== null && curMean !== undefined
                          ? `${curMean} ${metricMeta.unit}`
                          : '—'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs">
                      <span className="text-[var(--text-muted)]">Prior Equal Window Mean</span>
                      <p className="mt-1 font-[family-name:var(--font-mono)] text-base font-bold tabular-nums">
                        {prevMean !== null && prevMean !== undefined
                          ? `${prevMean} ${metricMeta.unit}`
                          : '—'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs">
                      <span className="text-[var(--text-muted)]">Window-vs-Window Shift</span>
                      <p className="mt-1 font-[family-name:var(--font-mono)] text-base font-bold tabular-nums">
                        {delta !== null
                          ? `${delta >= 0 ? '+' : ''}${delta} ${metricMeta.unit}`
                          : '—'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <VitalsChart
                      title={metricMeta.label}
                      unit={metricMeta.unit}
                      points={seriesQuery.data?.points ?? []}
                      bandLow={seriesQuery.data?.baseline?.bandLow}
                      bandHigh={seriesQuery.data?.baseline?.bandHigh}
                      medianVal={seriesQuery.data?.baseline?.medianVal}
                      changePoints={seriesQuery.data?.changePoints ?? []}
                      alertTimestamps={(seriesQuery.data?.alertMarkers ?? []).map((a) => a.timestamp)}
                      medMarkers={seriesQuery.data?.medMarkers ?? []}
                      loading={seriesQuery.isLoading}
                      error={seriesQuery.isError ? 'Failed to fetch vital series.' : null}
                      onRetry={() => seriesQuery.refetch()}
                      baselineStage={seriesQuery.data?.baseline?.stage}
                      validDays={seriesQuery.data?.baseline?.validDays}
                      isSynthetic={overviewQuery.data?.isSynthetic}
                    />
                  </div>
                </div>
              </section>

              <aside className="mint-bento space-y-5 p-4 sm:p-5 xl:col-span-4">
                {/* Anomaly Explanations */}
                <div className="clinical-card p-5">
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                    <h2 className="font-[family-name:var(--font-display)] text-lg font-bold">
                      Anomaly Explanations
                    </h2>
                  </div>
                  <p className="mt-2 text-sm">
                    {overviewQuery.data?.latestAssessment?.explanationEn ??
                      'Awaiting baseline assessment.'}
                  </p>
                  {overviewQuery.data?.latestAssessment && (
                    <div className="mt-3 grid grid-cols-3 gap-2 font-[family-name:var(--font-mono)] text-xs">
                      <div className="rounded-lg bg-[var(--bg-elevated)] p-2">
                        <span className="block text-[var(--text-muted)]">L1 Safety</span>
                        <strong>{overviewQuery.data.latestAssessment.l1Score}</strong>
                      </div>
                      <div className="rounded-lg bg-[var(--bg-elevated)] p-2">
                        <span className="block text-[var(--text-muted)]">L2 Personal</span>
                        <strong>{overviewQuery.data.latestAssessment.l2Score}</strong>
                      </div>
                      <div className="rounded-lg bg-[var(--bg-elevated)] p-2">
                        <span className="block text-[var(--text-muted)]">L3 Cohort</span>
                        <strong>{overviewQuery.data.latestAssessment.l3Score}</strong>
                      </div>
                    </div>
                  )}
                  <ul className="mt-3 space-y-2 text-xs">
                    {(overviewQuery.data?.latestAssessment?.contributions ?? [])
                      .slice(0, 4)
                      .map((c) => (
                        <li
                          key={c.metricType}
                          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2.5"
                        >
                          <div className="flex justify-between font-semibold">
                            <span>{c.label}</span>
                            <span className="font-[family-name:var(--font-mono)]">{c.sharePct}%</span>
                          </div>
                          <p className="mt-0.5 text-[var(--text-muted)]">
                            {c.observed} {c.unit} vs normal {c.normalLow}–{c.normalHigh} {c.unit}
                          </p>
                        </li>
                      ))}
                  </ul>
                </div>

                {/* Alert History */}
                <div className="clinical-card p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <BellRing className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                      <h2 className="font-[family-name:var(--font-display)] text-lg font-bold">
                        Alert History
                      </h2>
                    </div>
                    <Link
                      href="/alerts"
                      className="text-xs font-semibold text-[var(--brand-accent-text)] hover:underline"
                    >
                      Open Alerts →
                    </Link>
                  </div>
                  {(overviewQuery.data?.alerts ?? []).length === 0 ? (
                    <p className="mt-2 text-xs text-[var(--text-muted)]">No alerts recorded yet.</p>
                  ) : (
                    <ul className="mt-3 space-y-2 text-xs">
                      {(overviewQuery.data?.alerts ?? []).slice(0, 4).map((al) => (
                        <li
                          key={al.id}
                          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <StatusBadge level={al.level} />
                            <span className="font-[family-name:var(--font-mono)] text-[var(--text-muted)]">
                              {al.status} (Step {al.escalationStep})
                            </span>
                          </div>
                          <p className="mt-1">{al.summaryEn}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </aside>
            </div>

            {/* Partial NEWS2 7-Parameter Transparent Breakdown */}
            <section className="mint-bento p-4 sm:p-5">
              <div className="clinical-card p-5 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-[family-name:var(--font-display)] text-lg font-bold">
                    Partial NEWS2 Assessment (Wearable Subset Only)
                  </h2>
                  <span className="rounded-full bg-[var(--bg-elevated)] px-3 py-1 font-[family-name:var(--font-mono)] text-xs font-bold">
                    {overviewQuery.data?.latestAssessment?.partialNews2?.partialScore ?? 0} pts (
                    {overviewQuery.data?.latestAssessment?.partialNews2?.scoredParameterCount ?? 0}/7
                    parameters)
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {overviewQuery.data?.latestAssessment?.partialNews2?.disclaimer ??
                    'Missing clinical parameters are explicitly labeled unavailable rather than assumed normal.'}
                </p>

                <div
                  tabIndex={0}
                  role="region"
                  aria-label="Partial NEWS2 breakdown"
                  className="mt-3 overflow-x-auto"
                >
                  <table className="w-full text-left text-xs sm:text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
                        <th className="py-2 pr-3">Parameter</th>
                        <th className="py-2 pr-3">Observed</th>
                        <th className="py-2 pr-3">NEWS2 Points</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2">Rule / Limitation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {(overviewQuery.data?.latestAssessment?.partialNews2?.parameters ?? []).map(
                        (p) => (
                          <tr key={p.parameter}>
                            <td className="py-2.5 pr-3 font-[family-name:var(--font-mono)] text-xs font-semibold">
                              {p.parameter}
                            </td>
                            <td className="py-2.5 pr-3 font-[family-name:var(--font-mono)]">
                              {p.observedValue ?? '—'}
                            </td>
                            <td className="py-2.5 pr-3 font-[family-name:var(--font-mono)] font-bold">
                              {p.points ?? 'N/A'}
                            </td>
                            <td className="py-2.5 pr-3 font-[family-name:var(--font-mono)] text-xs">
                              {p.status}
                            </td>
                            <td className="py-2.5 text-xs text-[var(--text-muted)]">{p.rule}</td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </SentinelShell>
  );
}
