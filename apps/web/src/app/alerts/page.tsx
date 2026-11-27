'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BellRing,
  CheckCircle2,
  Clock,
  Hospital,
  PhoneCall,
  Radio,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { SignedOutGate } from '@/components/health/signed-out-gate';
import { SentinelShell } from '@/components/sentinel-shell';

interface AlertsResponse {
  patientId: string;
  settings: {
    emergencyNumber: string;
    ambulanceNumber: string;
    quietHoursStart: number;
    quietHoursEnd: number;
    dailyAlertBudget: number;
    sensitivityOffset: number;
    city: string | null;
  } | null;
  alerts: Array<{
    id: string;
    alertType: string;
    level: string;
    ruleKey: string;
    summaryEn: string;
    summaryKn: string;
    summaryHi: string;
    status: string;
    escalationStep: number;
    nextEscalationAt: string | null;
    feedback: string | null;
    isSynthetic: boolean;
    createdAt: string;
  }>;
  deliveries: Array<{
    id: string;
    alertId: string;
    channel: string;
    status: string;
    attemptCount: number;
    providerReceipt: string | null;
    lastError: string | null;
    payload: {
      recipientName?: string;
      roleLabel?: string;
      subject?: string;
      bodyText?: string;
      actionToken?: string;
      step?: number;
    };
    createdAt: string;
  }>;
}

interface HospitalsResponse {
  emergencyNumber: string;
  ambulanceNumber: string;
  city: string;
  hospitals: Array<{
    name: string;
    distanceKm: number;
    city: string;
    source: string;
  }>;
}

const STEP_LABELS = [
  'Step 0 · Patient Nudge',
  'Step 1 · Primary Caregiver',
  'Step 2 · Secondary Caregiver',
  'Step 3 · Assigned Clinician',
  'Step 4 · Emergency 112 / 108',
];

export default function AlertsOperationsPage() {
  const qc = useQueryClient();
  const [sseConnected, setSseConnected] = useState(false);
  const [lastSseEvent, setLastSseEvent] = useState<string>('Listening for real-time alert events');
  const [banner, setBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const alertsQuery = useQuery<AlertsResponse>({
    queryKey: ['alerts-ops'],
    queryFn: async () => {
      const res = await fetch('/api/v1/alerts');
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const hospitalsQuery = useQuery<HospitalsResponse>({
    queryKey: ['emergency-hospitals'],
    enabled: !alertsQuery.isError,
    queryFn: async () => {
      const res = await fetch('/api/v1/emergency/hospitals');
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  useEffect(() => {
    if (alertsQuery.isError) return;
    const es = new EventSource('/api/v1/stream');
    es.addEventListener('connected', () => setSseConnected(true));
    const onStreamUpdate = (evt: MessageEvent) => {
      setLastSseEvent(`Live SSE event (${evt.type}) at ${new Date().toLocaleTimeString()}`);
      qc.invalidateQueries({ queryKey: ['alerts-ops'] });
    };
    for (const evName of ['alert.created', 'alert.acknowledged', 'alert.escalated', 'alert.resolved', 'engine.evaluated']) {
      es.addEventListener(evName, onStreamUpdate);
    }
    es.onerror = () => setSseConnected(false);
    return () => {
      es.close();
    };
  }, [alertsQuery.isError, qc]);

  const evaluateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/engine/evaluate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bypassPersistence: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Evaluation failed');
      return body;
    },
    onSuccess: (data) => {
      setErrorBanner(null);
      setBanner(
        `Evaluated (Index ${data.deteriorationIndex}, policy: ${data.alertPolicyResult?.outcome ?? 'ok'} — ${data.alertPolicyResult?.reason ?? ''}).`,
      );
      qc.invalidateQueries({ queryKey: ['alerts-ops'] });
    },
    onError: (err) => setErrorBanner(err instanceof Error ? err.message : 'Evaluation failed'),
  });

  const actionMutation = useMutation({
    mutationFn: async (vars: {
      alertId: string;
      action: 'acknowledge' | 'snooze' | 'escalate' | 'resolve';
      feedback?: 'helpful' | 'false_alarm' | 'expected_activity';
    }) => {
      const res = await fetch(`/api/v1/alerts/${vars.alertId}/ack`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: vars.action,
          feedback: vars.feedback,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Alert update failed');
      return body;
    },
    onSuccess: (data) => {
      setErrorBanner(null);
      setBanner(`Alert updated to status: ${data.status}.`);
      qc.invalidateQueries({ queryKey: ['alerts-ops'] });
    },
    onError: (err) => setErrorBanner(err instanceof Error ? err.message : 'Update failed'),
  });

  const isUnauth = alertsQuery.error?.message === '401';
  const hasSynthetic = (alertsQuery.data?.alerts ?? []).some((a) => a.isSynthetic);

  return (
    <SentinelShell
      title="Alerts, Escalation & Outbox Delivery"
      subtitle="Anti-fatigue notification routing, escalation ladder & Cloudflare inbound replies"
      isSynthetic={hasSynthetic}
      rightSlot={
        <span
          data-testid="sse-status"
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-1 text-xs font-semibold"
        >
          <Radio
            className={`h-3.5 w-3.5 ${sseConnected ? 'text-[var(--status-stable)]' : 'text-[var(--text-muted)]'}`}
            aria-hidden="true"
          />
          <span>{sseConnected ? 'Live SSE' : 'Connecting SSE'}</span>
        </span>
      }
    >
      <main className="space-y-6">
        {isUnauth ? (
          <SignedOutGate
            heading="Sign in required for Alerts & Escalation"
            description="Sign in as a patient, caregiver, or clinician to view active alerts and outbox logs."
          />
        ) : (
          <>
            {banner && (
              <div
                role="status"
                className="rounded-xl border border-[var(--status-stable)] bg-[var(--status-stable-bg)] px-4 py-3 text-sm font-medium text-[var(--status-stable)]"
              >
                {banner}
              </div>
            )}
            {errorBanner && (
              <div
                role="alert"
                className="rounded-xl border border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] px-4 py-3 text-sm font-medium text-[var(--status-urgent)]"
              >
                {errorBanner}
              </div>
            )}

            {/* Policy & Controls Strip */}
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
              <div className="space-y-1">
                <p className="text-sm font-semibold">Anti-Fatigue Alert Policy & Live Stream</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Budget: {alertsQuery.data?.settings?.dailyAlertBudget ?? 6}/day · Quiet Hours:{' '}
                  {String(alertsQuery.data?.settings?.quietHoursStart ?? 22).padStart(2, '0')}:00–
                  {String(alertsQuery.data?.settings?.quietHoursEnd ?? 6).padStart(2, '0')}:00 (Urgent always bypasses) ·
                  Sensitivity Offset:{' '}
                  <span className="font-[family-name:var(--font-mono)]">
                    {(alertsQuery.data?.settings?.sensitivityOffset ?? 0).toFixed(2)}
                  </span>{' '}
                  · {lastSseEvent}
                </p>
              </div>
              <button
                type="button"
                onClick={() => evaluateMutation.mutate()}
                disabled={evaluateMutation.isPending}
                className="min-h-11 rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-[var(--brand-primary-fg)] cursor-pointer"
              >
                {evaluateMutation.isPending ? 'Evaluating...' : 'Evaluate & Dispatch Alerts'}
              </button>
            </section>

            {/* Emergency Numbers & Nearest Hospitals */}
            <section className="rounded-2xl border border-[var(--status-urgent)] bg-[var(--bg-surface)] p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <PhoneCall className="h-5 w-5 text-[var(--status-urgent)]" aria-hidden="true" />
                  <h2 className="text-lg font-semibold">Emergency Safety Path & Nearest Hospitals</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-lg bg-[var(--status-urgent-bg)] px-3 py-1.5 font-[family-name:var(--font-mono)] text-sm font-bold text-[var(--status-urgent)]">
                    Emergency: {hospitalsQuery.data?.emergencyNumber ?? '112'}
                  </span>
                  <span className="rounded-lg bg-[var(--status-urgent-bg)] px-3 py-1.5 font-[family-name:var(--font-mono)] text-sm font-bold text-[var(--status-urgent)]">
                    Ambulance: {hospitalsQuery.data?.ambulanceNumber ?? '108'}
                  </span>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(hospitalsQuery.data?.hospitals ?? []).map((h) => (
                  <div
                    key={h.name}
                    className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      <Hospital className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
                      <span>{h.name}</span>
                    </div>
                    <p className="mt-1 font-[family-name:var(--font-mono)] text-xs text-[var(--text-muted)]">
                      ~{h.distanceKm} km · {h.city}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* Active Alerts & Escalation Ladder */}
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <BellRing className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                <h2 className="text-lg font-semibold">Alert Timeline & Escalation Ladder</h2>
              </div>

              {(alertsQuery.data?.alerts ?? []).length === 0 ? (
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 text-sm text-[var(--text-muted)]">
                  No alerts fired yet. Load data on <Link href="/ingest" className="underline">/ingest</Link> and click &quot;Evaluate & Dispatch Alerts&quot;.
                </div>
              ) : (
                <div className="space-y-4">
                  {(alertsQuery.data?.alerts ?? []).map((al) => (
                    <article
                      key={al.id}
                      data-testid={`alert-card-${al.id}`}
                      className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-[var(--status-watch-bg)] px-2.5 py-0.5 text-xs font-bold uppercase text-[var(--status-watch)]">
                            {al.level}
                          </span>
                          <span className="rounded-full border border-[var(--border-subtle)] px-2.5 py-0.5 text-xs font-semibold">
                            {al.status}
                          </span>
                          <span className="text-xs font-semibold text-[var(--brand-primary)]">
                            {STEP_LABELS[al.escalationStep] ?? `Step ${al.escalationStep}`}
                          </span>
                          {al.isSynthetic && (
                            <span className="rounded-full bg-[var(--status-synthetic-bg)] px-2 py-0.5 text-xs font-bold text-[var(--status-synthetic)]">
                              SYNTHETIC
                            </span>
                          )}
                        </div>
                        <span className="font-[family-name:var(--font-mono)] text-xs text-[var(--text-muted)]">
                          {new Date(al.createdAt).toLocaleString()}
                        </span>
                      </div>

                      <p className="mt-3 text-sm font-medium">{al.summaryEn}</p>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            actionMutation.mutate({
                              alertId: al.id,
                              action: 'acknowledge',
                              feedback: 'helpful',
                            })
                          }
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[var(--status-stable)] px-3 text-xs font-semibold text-white cursor-pointer"
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          <span>Acknowledge (OK · Helpful)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            actionMutation.mutate({ alertId: al.id, action: 'snooze' })
                          }
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 text-xs font-semibold hover:bg-[var(--bg-elevated)] cursor-pointer"
                        >
                          <Clock className="h-4 w-4" aria-hidden="true" />
                          <span>Snooze 2h</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            actionMutation.mutate({ alertId: al.id, action: 'escalate' })
                          }
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[var(--status-watch)] px-3 text-xs font-semibold text-white cursor-pointer"
                        >
                          <TrendingUp className="h-4 w-4" aria-hidden="true" />
                          <span>Escalate Step (CALL ME)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            actionMutation.mutate({
                              alertId: al.id,
                              action: 'resolve',
                              feedback: 'false_alarm',
                            })
                          }
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 text-xs font-semibold hover:bg-[var(--bg-elevated)] cursor-pointer"
                        >
                          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                          <span>Mark False Alarm</span>
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            {/* Transactional Outbox Delivery Log */}
            <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
              <h2 className="text-lg font-semibold">Transactional Outbox Delivery Receipts</h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Idempotent delivery records across In-App SSE, Web Push (VAPID), Email, ntfy,
                Telegram, and gated SMS.
              </p>
              <div
                tabIndex={0}
                role="region"
                aria-label="Transactional outbox deliveries"
                className="mt-3 overflow-x-auto"
              >
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
                      <th className="py-2 pr-3">Channel</th>
                      <th className="py-2 pr-3">Recipient</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Receipt / Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {(alertsQuery.data?.deliveries ?? []).map((d) => (
                      <tr key={d.id}>
                        <td className="py-2 pr-3 font-[family-name:var(--font-mono)] text-xs font-semibold">
                          {d.channel}
                        </td>
                        <td className="py-2 pr-3">
                          {d.payload?.recipientName ?? 'Care Circle'} ({d.payload?.roleLabel ?? 'member'})
                        </td>
                        <td className="py-2 pr-3 font-[family-name:var(--font-mono)] text-xs">
                          {d.status}
                        </td>
                        <td className="py-2 pr-3 font-[family-name:var(--font-mono)] text-xs text-[var(--text-muted)]">
                          {d.providerReceipt ?? d.lastError ?? 'queued'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </SentinelShell>
  );
}
