'use client';

import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { SignedOutGate } from '@/components/health/signed-out-gate';
import { SentinelShell } from '@/components/sentinel-shell';

interface ConsentGrantRow {
  id: string;
  patientId: string;
  granteeUserId: string;
  granteeName?: string;
  granteeEmail?: string;
  relationship: string;
  scopes: string[];
  grantedAt: string;
  withdrawnAt: string | null;
  reason: string | null;
}

interface CareCircleMember {
  id: string;
  invitedEmail: string | null;
  memberName?: string | null;
  relationship: string;
  priorityOrder: number;
  status: string;
}

interface AuditVerifyResponse {
  totalChecked: number;
  chainValid: boolean;
  brokenAtSeq: number | null;
  recentEntries: Array<{
    seq: number;
    action: string;
    targetType: string;
    targetId: string;
    entryHash: string;
    createdAtIso: string;
  }>;
}

export default function ConsentLedgerPage() {
  const qc = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRel, setInviteRel] = useState<'primary_caregiver' | 'secondary_caregiver' | 'clinician'>('secondary_caregiver');
  const [feedback, setFeedback] = useState<string | null>(null);

  const consentQuery = useQuery<{ patientId: string | null; grants: ConsentGrantRow[] }>({
    queryKey: ['consent'],
    queryFn: async () => {
      const res = await fetch('/api/v1/consent');
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const circleQuery = useQuery<{ members: CareCircleMember[] }>({
    queryKey: ['care-circle'],
    queryFn: async () => {
      const res = await fetch('/api/v1/care-circle');
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const auditQuery = useQuery<AuditVerifyResponse>({
    queryKey: ['audit-verify'],
    queryFn: async () => {
      const res = await fetch('/api/v1/audit/verify');
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const toggleConsent = useMutation({
    mutationFn: async (input: {
      granteeUserId: string;
      relationship: 'caregiver' | 'clinician' | 'researcher';
      scopes: string[];
      action: 'grant' | 'withdraw';
    }) => {
      const res = await fetch('/api/v1/consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed updating consent');
      return json;
    },
    onSuccess: (_data, vars) => {
      setFeedback(
        vars.action === 'withdraw'
          ? 'Consent withdrawn immediately and recorded in hash-chained audit log.'
          : 'Consent restored and recorded in hash-chained audit log.',
      );
      qc.invalidateQueries({ queryKey: ['consent'] });
      qc.invalidateQueries({ queryKey: ['audit-verify'] });
    },
    onError: (err) => setFeedback(err instanceof Error ? err.message : 'Consent update failed'),
  });

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/care-circle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail,
          relationship: inviteRel,
          priorityOrder: 2,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Invite failed');
      return json;
    },
    onSuccess: () => {
      setInviteEmail('');
      setFeedback('Care circle invitation recorded and logged.');
      qc.invalidateQueries({ queryKey: ['care-circle'] });
      qc.invalidateQueries({ queryKey: ['consent'] });
      qc.invalidateQueries({ queryKey: ['audit-verify'] });
    },
    onError: (err) => setFeedback(err instanceof Error ? err.message : 'Invite failed'),
  });

  function handleInvite(e: FormEvent) {
    e.preventDefault();
    inviteMutation.mutate();
  }

  const isUnauth =
    consentQuery.error?.message === '401' || auditQuery.error?.message === '401';

  return (
    <SentinelShell
      title="Care Circle, Consent Ledger & Audit Chain"
      subtitle="Granular Row-Level Security consent scopes and SHA-256 append-only audit proof"
    >
      <main className="space-y-6">
        {isUnauth ? (
          <SignedOutGate
            heading="Authentication required"
            description="Sign in as a patient, caregiver, or clinician to view or manage DPDP consent grants."
          />
        ) : (
          <>
            {feedback && (
              <div
                role="status"
                className="rounded-xl border border-[var(--brand-primary)] bg-[var(--bg-surface)] p-4 text-sm font-medium"
              >
                {feedback}
              </div>
            )}

            <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">DPDP Act 2023 Granular Consent Ledger</h2>
                  <p className="text-sm text-[var(--text-muted)]">
                    Every access scope is enforced by PostgreSQL Row-Level Security and can be
                    withdrawn immediately.
                  </p>
                </div>
              </div>

              {consentQuery.isLoading ? (
                <div className="mt-4 h-28 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
              ) : (
                <div className="mt-4 divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)]">
                  {(consentQuery.data?.grants ?? []).map((grant) => {
                    const active = grant.withdrawnAt === null;
                    return (
                      <div
                        key={grant.id}
                        className="flex flex-wrap items-center justify-between gap-4 p-4"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">
                              {grant.granteeName ?? grant.granteeUserId}
                            </span>
                            <span className="rounded-full bg-[var(--bg-elevated)] px-2.5 py-0.5 text-xs font-medium capitalize">
                              {grant.relationship}
                            </span>
                            {active ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--status-stable-bg)] px-2.5 py-0.5 text-xs font-semibold text-[var(--status-stable)]">
                                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[var(--status-urgent-bg)] px-2.5 py-0.5 text-xs font-semibold text-[var(--status-urgent)]">
                                <XCircle className="h-3 w-3" aria-hidden="true" />
                                Withdrawn
                              </span>
                            )}
                          </div>
                          <p className="mt-1 font-[family-name:var(--font-mono)] text-xs text-[var(--text-muted)]">
                            Scopes: {grant.scopes.join(', ')}
                          </p>
                        </div>

                        {consentQuery.data?.patientId && (
                          <button
                            type="button"
                            onClick={() =>
                              toggleConsent.mutate({
                                granteeUserId: grant.granteeUserId,
                                relationship: (grant.relationship === 'clinician'
                                  ? 'clinician'
                                  : 'caregiver') as 'caregiver' | 'clinician',
                                scopes: grant.scopes,
                                action: active ? 'withdraw' : 'grant',
                              })
                            }
                            className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 text-sm font-semibold hover:opacity-90 cursor-pointer"
                          >
                            {active ? 'Withdraw Consent' : 'Re-grant Consent'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {(consentQuery.data?.grants.length ?? 0) === 0 && (
                    <p className="p-4 text-sm text-[var(--text-muted)]">
                      No consent grants recorded yet.
                    </p>
                  )}
                </div>
              )}
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
                <h2 className="text-lg font-semibold">Care Circle Members</h2>
                <ul className="mt-4 space-y-2">
                  {(circleQuery.data?.members ?? []).map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] px-4 py-3 text-sm"
                    >
                      <div>
                        <p className="font-semibold">{m.memberName ?? m.invitedEmail}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {m.relationship} · Priority {m.priorityOrder}
                        </p>
                      </div>
                      <span className="rounded-full bg-[var(--bg-elevated)] px-2.5 py-0.5 text-xs font-medium capitalize">
                        {m.status}
                      </span>
                    </li>
                  ))}
                </ul>

                {consentQuery.data?.patientId && (
                  <form onSubmit={handleInvite} className="mt-5 flex flex-wrap gap-2">
                    <label htmlFor="invite-email" className="sr-only">
                      Caregiver or clinician email
                    </label>
                    <input
                      id="invite-email"
                      type="email"
                      required
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="caregiver@example.com"
                      className="min-h-11 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm"
                    />
                    <select
                      aria-label="Relationship"
                      value={inviteRel}
                      onChange={(e) =>
                        setInviteRel(
                          e.target.value as
                            | 'primary_caregiver'
                            | 'secondary_caregiver'
                            | 'clinician',
                        )
                      }
                      className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm"
                    >
                      <option value="primary_caregiver">Primary Caregiver</option>
                      <option value="secondary_caregiver">Secondary Caregiver</option>
                      <option value="clinician">Clinician</option>
                    </select>
                    <button
                      type="submit"
                      disabled={inviteMutation.isPending}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-[var(--brand-primary)] px-4 text-sm font-semibold text-[var(--brand-primary-fg)] cursor-pointer"
                    >
                      <UserPlus className="h-4 w-4" aria-hidden="true" />
                      <span>Invite</span>
                    </button>
                  </form>
                )}
              </section>

              <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">Append-Only Hash-Chained Audit Log</h2>
                  {auditQuery.data?.chainValid ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--status-stable-bg)] px-3 py-1 text-xs font-semibold text-[var(--status-stable)]">
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      Chain Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--status-urgent-bg)] px-3 py-1 text-xs font-semibold text-[var(--status-urgent)]">
                      <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                      Verify Pending
                    </span>
                  )}
                </div>

                <div
                  tabIndex={0}
                  role="region"
                  aria-label="Audit log entries"
                  className="mt-4 max-h-64 space-y-2 overflow-y-auto rounded-lg p-0.5"
                >
                  {(auditQuery.data?.recentEntries ?? []).map((entry) => (
                    <div
                      key={entry.seq}
                      className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-3 text-xs"
                    >
                      <div className="flex items-center justify-between font-semibold">
                        <span>
                          #{entry.seq} · {entry.action}
                        </span>
                        <span className="font-[family-name:var(--font-mono)] text-[var(--text-muted)]">
                          {entry.entryHash.slice(0, 12)}…
                        </span>
                      </div>
                      <p className="mt-1 text-[var(--text-muted)]">
                        {entry.targetType}: {entry.targetId}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </main>
    </SentinelShell>
  );
}
