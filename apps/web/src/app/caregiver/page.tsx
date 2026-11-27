'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  CloudSun,
  PhoneCall,
  Radio,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { VitalsChart, type VitalsChartPoint } from '@/components/charts/vitals-chart';
import { RoleWorkspaceGuard } from '@/components/health/role-gate';
import { SignedOutGate } from '@/components/health/signed-out-gate';
import { StatusBadge, SyntheticBadge } from '@/components/health/status-badge';
import { SentinelShell } from '@/components/sentinel-shell';

interface CohortRow {
  patientId: string;
  displayCode: string;
  patientName: string;
  deteriorationIndex: number;
  level: string;
  baselineStage: string;
  validDays: number;
  openAlertCount: number;
  isSynthetic: boolean;
}

interface CaregiverDashboardData {
  patientId: string;
  patientName: string;
  conditionModules: string[];
  emergencyNumber: string;
  ambulanceNumber: string;
  isSynthetic: boolean;
  silence: {
    hoursSilent: number | null;
    isSilent: boolean;
    wearRatio7d: number;
  };
  latestAssessment: {
    deteriorationIndex: number;
    level: string;
    explanationEn: string;
    contributions: Array<{ label: string; message: string; sharePct: number }>;
  } | null;
  alerts: Array<{
    id: string;
    level: string;
    status: string;
    escalationStep: number;
    summaryEn: string;
    isSynthetic: boolean;
    createdAt: string;
  }>;
  checkins: Array<{
    id: string;
    kind: string;
    severity: string;
    transcript: string | null;
    symptoms: string[];
    recordedAt: string;
  }>;
  environment: {
    city: string;
    apparentTempC: number;
    heatRiskLevel: string;
  } | null;
}

interface SeriesSummary {
  baseline: {
    stage: string;
    validDays: number;
    medianVal: number;
    bandLow: number | null;
    bandHigh: number | null;
  } | null;
  points: VitalsChartPoint[];
  changePoints: string[];
  alertMarkers: Array<{ timestamp: string }>;
}

export default function CaregiverConsolePage() {
  const qc = useQueryClient();
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [sseLive, setSseLive] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);

  const cohortQuery = useQuery<{ cohort: CohortRow[] }>({
    queryKey: ['clinician-cohort'],
    queryFn: async () => {
      const res = await fetch('/api/v1/clinician/cohort');
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const activePatientId = selectedPatientId ?? cohortQuery.data?.cohort[0]?.patientId ?? null;

  const detailQuery = useQuery<CaregiverDashboardData>({
    queryKey: ['dashboard-patient', activePatientId],
    enabled: Boolean(activePatientId),
    queryFn: async () => {
      const res = await fetch(`/api/v1/dashboard/patient?patientId=${activePatientId}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const trendQuery = useQuery<SeriesSummary>({
    queryKey: ['caregiver-trend-rhr', activePatientId],
    enabled: Boolean(activePatientId),
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/vitals/series?patientId=${activePatientId}&metric=resting_heart_rate&window=7d`,
      );
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  useEffect(() => {
    if (!activePatientId) return;
    const es = new EventSource(`/api/v1/stream?patientId=${activePatientId}`);
    es.addEventListener('connected', () => setSseLive(true));
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ['dashboard-patient', activePatientId] });
      qc.invalidateQueries({ queryKey: ['clinician-cohort'] });
    };
    for (const ev of ['alert.created', 'alert.acknowledged', 'alert.escalated', 'engine.evaluated']) {
      es.addEventListener(ev, refresh);
    }
    es.onerror = () => setSseLive(false);
    return () => es.close();
  }, [activePatientId, qc]);

  const ackMutation = useMutation({
    mutationFn: async (vars: {
      alertId: string;
      action: 'acknowledge' | 'snooze' | 'escalate';
    }) => {
      const res = await fetch(`/api/v1/alerts/${vars.alertId}/ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: vars.action,
          feedback: vars.action === 'acknowledge' ? 'helpful' : undefined,
        }),
      });
      if (!res.ok) throw new Error('Update failed');
      return res.json();
    },
    onSuccess: (data) => {
      setFeedbackBanner(`Alert status updated to "${data.status}".`);
      qc.invalidateQueries({ queryKey: ['dashboard-patient', activePatientId] });
      qc.invalidateQueries({ queryKey: ['clinician-cohort'] });
    },
  });

  const isUnauth = cohortQuery.error?.message === '401';

  return (
    <SentinelShell
      title="Caregiver Console"
      subtitle="Connected care circle, real-time alert escalation & trend summaries"
      isSynthetic={detailQuery.data?.isSynthetic}
      rightSlot={
        <span
          data-testid="caregiver-sse-pill"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-1 text-xs font-semibold"
        >
          <Radio
            className={`h-3.5 w-3.5 ${sseLive ? 'text-[var(--status-stable)]' : 'text-[var(--text-muted)]'}`}
            aria-hidden="true"
          />
          <span>{sseLive ? 'Live SSE' : 'Connecting'}</span>
        </span>
      }
    >
      <main className="space-y-6">
        <RoleWorkspaceGuard
          allowedRoles={['caregiver', 'org_admin']}
          workspaceName="Caregiver Monitor"
        >
        {isUnauth ? (
          <SignedOutGate
            heading="Sign in to access Caregiver Console"
            description="Dedicated login for family members and caregivers monitoring a linked elder's alerts and baseline trends."
            signInHref="/caregiver/login"
            signInLabel="Open Caregiver Portal Login"
          />
        ) : (
          <>
            {feedbackBanner && (
              <div
                role="status"
                className="rounded-xl border border-[var(--status-stable)] bg-[var(--status-stable-bg)] px-4 py-3 text-sm font-semibold text-[var(--status-stable)]"
              >
                {feedbackBanner}
              </div>
            )}

            {/* Connected Patients Selector */}
            <section aria-label="Connected patients" className="mint-bento p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-[family-name:var(--font-display)] text-base font-bold">
                  Connected Patients
                </h2>
                <Link
                  href="/settings/consent"
                  className="text-xs font-semibold text-[var(--brand-accent-text)] hover:underline"
                >
                  Manage Care Circle →
                </Link>
              </div>
              {cohortQuery.isSuccess && (cohortQuery.data?.cohort ?? []).length === 0 ? (
                <div className="clinical-card p-5 text-sm">
                  <p className="font-bold text-[var(--text-primary)]">
                    Caregiver Monitor ready — no elders linked to this account yet
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Ask the patient / elder to sign into their Patient account, open{' '}
                    <strong>My Care Circle (/settings/consent)</strong>, and invite your caregiver
                    email. Once invited, their live alerts, vitals, and check-ins appear here
                    automatically.
                  </p>
                </div>
              ) : (
              <div className="flex flex-wrap gap-3">
                {(cohortQuery.data?.cohort ?? []).map((p) => {
                  const selected = p.patientId === activePatientId;
                  return (
                    <button
                      key={p.patientId}
                      type="button"
                      onClick={() => setSelectedPatientId(p.patientId)}
                      className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 py-2 text-left text-sm font-semibold transition cursor-pointer ${
                        selected
                          ? 'border-[var(--brand-rail-active)] bg-[var(--brand-rail-active)] text-[var(--brand-rail-active-fg)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                      }`}
                    >
                      <span>{p.patientName}</span>
                      <span className="font-[family-name:var(--font-mono)] text-xs opacity-90">
                        Index {p.deteriorationIndex} ({p.level})
                      </span>
                    </button>
                  );
                })}
              </div>
              )}
            </section>

            {detailQuery.data && (
              <>
                <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="clinical-card p-5">
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Deterioration Index
                    </span>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p
                        data-testid="caregiver-index"
                        className="font-[family-name:var(--font-mono)] text-3xl font-bold tabular-nums"
                      >
                        {detailQuery.data.latestAssessment?.deteriorationIndex ?? 0}
                      </p>
                      <StatusBadge level={detailQuery.data.latestAssessment?.level ?? 'stable'} />
                    </div>
                  </div>

                  <div className="clinical-card p-5">
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Watch &amp; Wear Continuity
                    </span>
                    <p className="mt-2 font-[family-name:var(--font-mono)] text-2xl font-bold tabular-nums">
                      {detailQuery.data.silence.hoursSilent !== null
                        ? `${detailQuery.data.silence.hoursSilent}h ago`
                        : 'No data'}
                    </p>
                    <span className="text-xs text-[var(--text-muted)]">
                      7d wear: {Math.round(detailQuery.data.silence.wearRatio7d * 100)}%
                    </span>
                  </div>

                  <div className="clinical-card p-5">
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Last Elder Check-In
                    </span>
                    <p className="mt-2 text-base font-bold">
                      {detailQuery.data.checkins[0]
                        ? detailQuery.data.checkins[0].kind === 'tap_ok' ||
                          detailQuery.data.checkins[0].severity === 'none'
                          ? 'Feels Okay'
                          : `Needs Check-In (${detailQuery.data.checkins[0].severity})`
                        : 'No check-in yet'}
                    </p>
                    <span className="text-xs text-[var(--text-muted)]">
                      {detailQuery.data.checkins[0]
                        ? new Date(detailQuery.data.checkins[0].recordedAt).toLocaleString()
                        : 'Elder Mode /today'}
                    </span>
                  </div>

                  <div className="clinical-card p-5">
                    <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      <CloudSun className="h-3.5 w-3.5" aria-hidden="true" />
                      Ambient Heat Context
                    </span>
                    <p className="mt-2 font-[family-name:var(--font-mono)] text-2xl font-bold tabular-nums">
                      {detailQuery.data.environment
                        ? `${detailQuery.data.environment.apparentTempC.toFixed(1)}°C`
                        : 'Pending'}
                    </p>
                    <span className="text-xs text-[var(--text-muted)]">
                      Emergency {detailQuery.data.emergencyNumber} / {detailQuery.data.ambulanceNumber}
                    </span>
                  </div>
                </section>

                <div className="grid gap-6 lg:grid-cols-12">
                  {/* Left: Active Alerts & Escalation Ladder */}
                  <section className="mint-bento p-4 sm:p-5 lg:col-span-5">
                    <div className="clinical-card h-full p-5 sm:p-6">
                      <h2 className="font-[family-name:var(--font-display)] text-lg font-bold">
                        Active Care Alerts &amp; Escalation
                      </h2>
                      <div className="mt-4 space-y-3">
                        {detailQuery.data.alerts.length === 0 ? (
                          <p className="text-sm text-[var(--text-muted)]">No alerts recorded.</p>
                        ) : (
                          detailQuery.data.alerts.slice(0, 6).map((al) => (
                            <div
                              key={al.id}
                              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <div className="flex items-center gap-2">
                                  <StatusBadge level={al.level} />
                                  <span className="font-[family-name:var(--font-mono)] font-semibold text-[var(--text-muted)]">
                                    {al.status} · Step {al.escalationStep}
                                  </span>
                                </div>
                                {al.isSynthetic && <SyntheticBadge />}
                              </div>
                              <p className="mt-2 text-sm font-medium">{al.summaryEn}</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    ackMutation.mutate({ alertId: al.id, action: 'acknowledge' })
                                  }
                                  className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-[var(--status-stable)] px-3 text-xs font-semibold text-white cursor-pointer"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  Acknowledge
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    ackMutation.mutate({ alertId: al.id, action: 'snooze' })
                                  }
                                  className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-xs font-semibold cursor-pointer"
                                >
                                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                                  Snooze 2h
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    ackMutation.mutate({ alertId: al.id, action: 'escalate' })
                                  }
                                  className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-[var(--status-watch)] px-3 text-xs font-semibold text-white cursor-pointer"
                                >
                                  <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
                                  Escalate
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </section>

                  {/* Right: Health Trend Summary & Change Explanations */}
                  <section className="mint-bento space-y-5 p-4 sm:p-5 lg:col-span-7">
                    <div className="clinical-card p-5 sm:p-6">
                      <h2 className="font-[family-name:var(--font-display)] text-lg font-bold">
                        7-Day Resting Heart Rate Summary
                      </h2>
                      <div className="mt-3">
                        <VitalsChart
                          compact
                          title="Resting Heart Rate"
                          unit="bpm"
                          points={trendQuery.data?.points ?? []}
                          bandLow={trendQuery.data?.baseline?.bandLow}
                          bandHigh={trendQuery.data?.baseline?.bandHigh}
                          medianVal={trendQuery.data?.baseline?.medianVal}
                          changePoints={trendQuery.data?.changePoints ?? []}
                          alertTimestamps={(trendQuery.data?.alertMarkers ?? []).map(
                            (a) => a.timestamp,
                          )}
                          loading={trendQuery.isLoading}
                          baselineStage={trendQuery.data?.baseline?.stage}
                          validDays={trendQuery.data?.baseline?.validDays}
                          isSynthetic={detailQuery.data.isSynthetic}
                        />
                      </div>
                    </div>

                    <div className="clinical-card p-5 sm:p-6">
                      <h2 className="font-[family-name:var(--font-display)] text-lg font-bold">
                        Recent Check-Ins &amp; Safety Actions
                      </h2>
                      <p className="mt-2 text-sm text-[var(--text-primary)]">
                        {detailQuery.data.latestAssessment?.explanationEn ??
                          'Awaiting initial baseline assessment.'}
                      </p>

                      {detailQuery.data.checkins.length > 0 && (
                        <ul className="mt-3 space-y-2 text-xs">
                          {detailQuery.data.checkins.slice(0, 3).map((chk) => (
                            <li
                              key={chk.id}
                              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
                            >
                              <div className="flex items-center justify-between gap-2 font-semibold">
                                <span className="capitalize">
                                  {chk.kind === 'tap_ok'
                                    ? 'Elder Feels Okay'
                                    : `${chk.kind.replace('_', ' ')} (${chk.severity})`}
                                </span>
                                <span className="text-[var(--text-muted)]">
                                  {new Date(chk.recordedAt).toLocaleTimeString()}
                                </span>
                              </div>
                              {chk.transcript && (
                                <p className="mt-1 text-[var(--text-primary)]">
                                  &ldquo;{chk.transcript}&rdquo;
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}

                      <ul className="mt-3 space-y-2 text-xs text-[var(--text-muted)]">
                        {(detailQuery.data.latestAssessment?.contributions ?? [])
                          .slice(0, 4)
                          .map((c) => (
                            <li
                              key={c.label}
                              className="flex justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
                            >
                              <span>{c.message}</span>
                              <span className="font-[family-name:var(--font-mono)] font-semibold text-[var(--text-primary)]">
                                {c.sharePct}%
                              </span>
                            </li>
                          ))}
                      </ul>
                      <div className="mt-5 flex flex-wrap gap-3">
                        <Link
                          href="/ingest"
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 text-xs font-semibold hover:bg-[var(--bg-elevated)]"
                        >
                          <ShieldAlert className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
                          Help Connect Elder Watch / Phone
                        </Link>
                        <Link
                          href="/alerts"
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[var(--status-urgent)] px-4 text-xs font-semibold text-white"
                        >
                          <PhoneCall className="h-4 w-4" aria-hidden="true" />
                          Emergency Hospitals ({detailQuery.data.emergencyNumber})
                        </Link>
                      </div>
                    </div>
                  </section>
                </div>
              </>
            )}
          </>
        )}
        </RoleWorkspaceGuard>
      </main>
    </SentinelShell>
  );
}
