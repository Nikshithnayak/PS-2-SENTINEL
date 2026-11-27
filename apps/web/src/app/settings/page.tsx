'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, KeyRound, ShieldAlert, Sliders, Users } from 'lucide-react';
import { SignedOutGate } from '@/components/health/signed-out-gate';
import { SentinelShell } from '@/components/sentinel-shell';

interface ProfilePayload {
  profile: {
    id: string;
    locale: 'en' | 'kn' | 'hi';
    quietHoursStart: number;
    quietHoursEnd: number;
    dailyAlertBudget: number;
    silentAlertHours: number;
    emergencyNumber: string;
    ambulanceNumber: string;
    city: string | null;
    conditionModules: string[];
    sensitivityOffset: number;
  } | null;
}

const CONDITIONS = [
  'general_frailty',
  'heart_failure',
  'copd',
  'hypertension',
  'diabetes',
] as const;

export default function SettingsPage() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const profileQuery = useQuery<ProfilePayload>({
    queryKey: ['settings-profile'],
    queryFn: async () => {
      const res = await fetch('/api/v1/settings/profile');
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const [locale, setLocale] = useState<'en' | 'kn' | 'hi'>('en');
  const [quietStart, setQuietStart] = useState(22);
  const [quietEnd, setQuietEnd] = useState(6);
  const [budget, setBudget] = useState(6);
  const [silentHours, setSilentHours] = useState(12);
  const [emergencyNum, setEmergencyNum] = useState('112');
  const [ambulanceNum, setAmbulanceNum] = useState('108');
  const [city, setCity] = useState('');
  const [modules, setModules] = useState<string[]>(['general_frailty']);
  const [erasePhrase, setErasePhrase] = useState('');

  useEffect(() => {
    const p = profileQuery.data?.profile;
    if (!p) return;
    setLocale(p.locale);
    setQuietStart(p.quietHoursStart);
    setQuietEnd(p.quietHoursEnd);
    setBudget(p.dailyAlertBudget);
    setSilentHours(p.silentAlertHours);
    setEmergencyNum(p.emergencyNumber);
    setAmbulanceNum(p.ambulanceNumber);
    setCity(p.city ?? '');
    setModules(p.conditionModules);
  }, [profileQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/settings/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          locale,
          quietHoursStart: quietStart,
          quietHoursEnd: quietEnd,
          dailyAlertBudget: budget,
          silentAlertHours: silentHours,
          emergencyNumber: emergencyNum,
          ambulanceNumber: ambulanceNum,
          ...(city.trim().length >= 2 ? { city: city.trim() } : {}),
          conditionModules: modules.length > 0 ? modules : ['general_frailty'],
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Save failed');
      return body;
    },
    onSuccess: () => {
      setErr(null);
      setMsg('Care preferences & alert thresholds saved.');
      qc.invalidateQueries({ queryKey: ['settings-profile'] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Save failed'),
  });

  const eraseMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/privacy/erase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmPhrase: erasePhrase }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Erasure blocked');
      return body;
    },
    onSuccess: () => {
      setErr(null);
      setMsg('DPDP Erasure completed: encrypted PII scrubbed, consent & API keys revoked.');
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Erasure failed'),
  });

  function onSave(e: FormEvent) {
    e.preventDefault();
    saveMutation.mutate();
  }

  const isUnauth = profileQuery.error?.message === '401';

  return (
    <SentinelShell
      title="Settings, Care Circle & DPDP Privacy"
      subtitle="Quiet hours, daily alert budget, emergency contacts & DPDP Act 2023 data rights"
    >
      <main className="space-y-6">
        {isUnauth ? (
          <SignedOutGate heading="Sign in to manage settings" />
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
            {err && (
              <div
                role="alert"
                className="rounded-xl border border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] px-4 py-3 text-sm font-medium text-[var(--status-urgent)]"
              >
                {err}
              </div>
            )}

            {/* Quick Links */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Link
                href="/settings/consent"
                className="flex min-h-14 items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 font-semibold hover:bg-[var(--bg-elevated)]"
              >
                <Users className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                <span>Manage Care Circle & Consent Ledger</span>
              </Link>
              <Link
                href="/ingest"
                className="flex min-h-14 items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 font-semibold hover:bg-[var(--bg-elevated)]"
              >
                <KeyRound className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                <span>Manage Wearable Providers & API Keys</span>
              </Link>
            </div>

            {/* Alert Policy & Clinical Profile Form */}
            <form
              onSubmit={onSave}
              className="space-y-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6"
            >
              <div className="flex items-center gap-2">
                <Sliders className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                <h2 className="text-lg font-semibold">Alert Policy, Language & Emergency Config</h2>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <label className="space-y-1 text-xs font-semibold">
                  <span>Preferred Language</span>
                  <select
                    value={locale}
                    onChange={(e) => setLocale(e.target.value as 'en' | 'kn' | 'hi')}
                    className="min-h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm"
                  >
                    <option value="en">English</option>
                    <option value="kn">ಕನ್ನಡ (Kannada)</option>
                    <option value="hi">हिन्दी (Hindi)</option>
                  </select>
                </label>

                <label className="space-y-1 text-xs font-semibold">
                  <span>Quiet Hours Start (24h)</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={quietStart}
                    onChange={(e) => setQuietStart(Number(e.target.value))}
                    className="min-h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm"
                  />
                </label>

                <label className="space-y-1 text-xs font-semibold">
                  <span>Quiet Hours End (24h)</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={quietEnd}
                    onChange={(e) => setQuietEnd(Number(e.target.value))}
                    className="min-h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm"
                  />
                </label>

                <label className="space-y-1 text-xs font-semibold">
                  <span>Daily Alert Budget</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value))}
                    className="min-h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm"
                  />
                </label>

                <label className="space-y-1 text-xs font-semibold">
                  <span>Silence Notice Threshold (hrs)</span>
                  <input
                    type="number"
                    min={4}
                    max={72}
                    value={silentHours}
                    onChange={(e) => setSilentHours(Number(e.target.value))}
                    className="min-h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm"
                  />
                </label>

                <label className="space-y-1 text-xs font-semibold">
                  <span>City (District-Rounded Weather)</span>
                  <input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="min-h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm"
                  />
                </label>

                <label className="space-y-1 text-xs font-semibold">
                  <span>Emergency Number</span>
                  <input
                    value={emergencyNum}
                    onChange={(e) => setEmergencyNum(e.target.value)}
                    className="min-h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm"
                  />
                </label>

                <label className="space-y-1 text-xs font-semibold">
                  <span>Ambulance Number</span>
                  <input
                    value={ambulanceNum}
                    onChange={(e) => setAmbulanceNum(e.target.value)}
                    className="min-h-11 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm"
                  />
                </label>
              </div>

              <div>
                <p className="text-xs font-semibold">Active Condition Modules (Priors & Weights)</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {CONDITIONS.map((cond) => {
                    const checked = modules.includes(cond);
                    return (
                      <button
                        key={cond}
                        type="button"
                        onClick={() =>
                          setModules((prev) =>
                            prev.includes(cond) ? prev.filter((c) => c !== cond) : [...prev, cond],
                          )
                        }
                        className={`min-h-10 rounded-lg border px-3 text-xs font-semibold cursor-pointer ${checked
                          ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]'
                          : 'border-[var(--border-subtle)]'
                          }`}
                      >
                        {cond}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="submit"
                disabled={saveMutation.isPending}
                className="min-h-11 rounded-xl bg-[var(--brand-primary)] px-5 text-sm font-semibold text-[var(--brand-primary-fg)] cursor-pointer"
              >
                {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
              </button>
            </form>

            {/* DPDP Act 2023 Export & Erasure */}
            <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
              <h2 className="text-lg font-semibold">DPDP Act 2023 Data Principal Rights</h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Download all your personal baselines, consent receipts, risk scores, and hourly
                rollups as portable JSON, or scrub identifiable contact records.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <a
                  href="/api/v1/privacy/export"
                  download
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border-subtle)] px-4 text-sm font-semibold hover:bg-[var(--bg-elevated)]"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span>Download Full DPDP JSON</span>
                </a>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-4">
                <label htmlFor="erase-confirm" className="sr-only">
                  Type ERASE MY DATA to confirm
                </label>
                <input
                  id="erase-confirm"
                  value={erasePhrase}
                  onChange={(e) => setErasePhrase(e.target.value)}
                  placeholder='Type "ERASE MY DATA" to confirm'
                  className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--status-urgent)] bg-[var(--bg-base)] px-3 text-sm"
                />
                <button
                  type="button"
                  onClick={() => eraseMutation.mutate()}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[var(--status-urgent)] px-4 text-sm font-semibold text-white cursor-pointer"
                >
                  <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                  <span>Execute DPDP Erasure</span>
                </button>
              </div>
            </section>
          </>
        )}
      </main>
    </SentinelShell>
  );
}
