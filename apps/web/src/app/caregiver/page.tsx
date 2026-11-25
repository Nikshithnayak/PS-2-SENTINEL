'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  CloudSun,
  Lock,
  PhoneCall,
  Radio,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { SentinelNav } from '@/components/sentinel-nav';

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
    symptoms: string[];
    recordedAt: string;
  }>;
  environment: {
    city: string;
    apparentTempC: number;
    heatRiskLevel: string;
  } | null;
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
    <div className="min-h-dvh bg-[var(--bg-base)] text-[var(--text-primary)]">
      <SentinelNav
        title="Caregiver Console"
        isSynthetic={detailQuery.data?.isSynthetic}
        rightSlot={
          <span
            data-testid="caregiver-sse-pill"
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] px-3 py-1 text-xs font-medium"
          >
            <Radio
              className={`h-3.5 w-3.5 ${sseLive ? 'text-[var(--status-stable)]' : 'text-[var(--text-muted)]'}`}
              aria-hidden="true"
            />
            <span>{sseLive ? 'Live SSE' : 'Connecting'}</span>
          </span>
        }
      />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        {isUnauth ? (
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
            <Lock className="mx-auto h-8 w-8 text-[var(--brand-primary)]" aria-hidden="true" />
            <h2 className="mt-3 text-xl font-semibold">Sign in to access Caregiver Console</h2>
            <Link
              href="/auth"
              className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-[var(--brand-primary)] px-5 font-semibold text-[var(--brand-primary-fg)]"
            >
              Sign In
            </Link>
          </div>
        ) : (
          <>
            {feedbackBanner && (
              <div
                role="status"
                className="rounded-xl border border-[var(--status-stable)] bg-[var(--status-stable-bg)] px-4 py-3 text-sm font-medium text-[var(--status-stable)]"
              >
                {feedbackBanner}
              </div>
            )}

            {/* Care Circle Selector */}
            <section className="flex flex-wrap items-center gap-3">
              {(cohortQuery.data?.cohort ?? []).map((p) => (
                <button
                  key={p.patientId}
                  type="button"
                  onClick={() => setSelectedPatientId(p.patientId)}
                  className={`min-h-11 rounded-xl border px-4 py-2 text-left text-sm font-semibold cursor-pointer ${
                    p.patientId === activePatientId
                      ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                  }`}
                >
                  {p.patientName} · Index {p.deteriorationIndex} ({p.level})
                </button>
              ))}
            </section>

            {detailQuery.data && (
              <>
                <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <span className="text-xs text-[var(--text-muted)]">Deterioration Index</span>
                    <p
                      data-testid="caregiver-index"
                      className="mt-1 font-[family-name:var(--font-mono)] text-2xl font-bold tabular-nums"
                    >
                      {detailQuery.data.latestAssessment?.deteriorationIndex ?? 0}
                    </p>
                    <span className="text-xs font-bold uppercase text-[var(--status-watch)]">
                      {detailQuery.data.latestAssessment?.level ?? 'stable'}
                    </span>
                  </div>
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <span className="text-xs text-[var(--text-muted)]">Watch & Silence</span>
                    <p className="mt-1 font-[family-name:var(--font-mono)] text-2xl font-bold tabular-nums">
                      {detailQuery.data.silence.hoursSilent !== null
                        ? `${detailQuery.data.silence.hoursSilent}h ago`
                        : 'No data'}
                    </p>
                    <span className="text-xs text-[var(--text-muted)]">
                      7d wear: {Math.round(detailQuery.data.silence.wearRatio7d * 100)}%
                    </span>
                  </div>
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <span className="text-xs text-[var(--text-muted)]">Last Elder Check-In</span>
                    <p className="mt-1 text-base font-semibold">
                      {detailQuery.data.checkins[0]
                        ? detailQuery.data.checkins[0].kind === 'tap_ok'
                          ? 'Feels Okay'
                          : `Unwell (${detailQuery.data.checkins[0].severity})`
                        : 'No check-in yet'}
                    </p>
                    <span className="text-xs text-[var(--text-muted)]">
                      {detailQuery.data.checkins[0]
                        ? new Date(detailQuery.data.checkins[0].recordedAt).toLocaleString()
                        : 'Elder Mode /today'}
                    </span>
                  </div>
                  <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                    <span className="inline-flex items-center gap-1 text-xs text-[var(--text-muted)]">
                      <CloudSun className="h-3.5 w-3.5" aria-hidden="true" />
                      Heat Context
                    </span>
                    <p className="mt-1 font-[family-name:var(--font-mono)] text-xl font-bold tabular-nums">
                      {detailQuery.data.environment
                        ? `${detailQuery.data.environment.apparentTempC.toFixed(1)}°C`
                        : 'Pending'}
                    </p>
                    <span className="text-xs text-[var(--text-muted)]">
                      Emergency {detailQuery.data.emergencyNumber} / {detailQuery.data.ambulanceNumber}
                    </span>
                  </div>
                </section>

                <div className="grid gap-6 lg:grid-cols-2">
                  <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
                    <h2 className="text-lg font-semibold">Active Care Alerts & Escalation</h2>
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
                              <span className="font-bold uppercase text-[var(--status-watch)]">
                                {al.level} · {al.status} (Step {al.escalationStep})
                              </span>
                              {al.isSynthetic && (
                                <span className="rounded-full bg-[var(--status-synthetic-bg)] px-2 py-0.5 font-bold text-[var(--status-synthetic)]">
                                  SYNTHETIC
                                </span>
                              )}
                            </div>
                            <p className="mt-2 text-sm">{al.summaryEn}</p>
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
                                className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-[var(--border-subtle)] px-3 text-xs font-semibold cursor-pointer"
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
                  </section>

                  <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
                    <h2 className="text-lg font-semibold">Latest Change Explanation & Safety Actions</h2>
                    <p className="mt-2 text-sm">
                      {detailQuery.data.latestAssessment?.explanationEn ??
                        'Awaiting initial baseline assessment.'}
                    </p>
                    <ul className="mt-3 space-y-2 text-xs text-[var(--text-muted)]">
                      {(detailQuery.data.latestAssessment?.contributions ?? []).slice(0, 4).map((c) => (
                        <li
                          key={c.label}
                          className="flex justify-between gap-2 rounded-lg border border-[var(--border-subtle)] p-2.5"
                        >
                          <span>{c.message}</span>
                          <span className="font-[family-name:var(--font-mono)]">{c.sharePct}%</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-5 flex flex-wrap gap-3">
                      <Link
                        href="/clinician"
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-4 text-xs font-semibold"
                      >
                        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                        Inspect Charts
                      </Link>
                      <Link
                        href="/alerts"
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[var(--status-urgent)] px-4 text-xs font-semibold text-white"
                      >
                        <PhoneCall className="h-4 w-4" aria-hidden="true" />
                        Emergency Hospitals ({detailQuery.data.emergencyNumber})
                      </Link>
                    </div>
                  </section>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
