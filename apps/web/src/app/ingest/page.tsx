'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeft,
  CloudSun,
  FileSpreadsheet,
  FileUp,
  FlaskConical,
  KeyRound,
  Lock,
  Radio,
  ShieldAlert,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

interface QualityStatusResponse {
  patientId: string;
  silence: {
    lastRecordedAt: string | null;
    hoursSilent: number | null;
    thresholdHours: number;
    isSilent: boolean;
    wearRatio7d: number;
  };
  adapters: Array<{
    configured: boolean;
    provider: string;
    status: string;
    message: string;
  }>;
  counts: {
    totalSamples: number;
    syntheticSamples: number;
    motionArtifacts: number;
  };
  hourlyRollupCount: number;
  batches: Array<{
    id: string;
    source: string;
    recordsReceived: number;
    recordsAccepted: number;
    recordsSkipped: number;
    isSynthetic: boolean;
    createdAt: string;
  }>;
  environment: {
    city: string;
    tempC: number;
    apparentTempC: number;
    humidityPct: number;
    pm25: number | null;
    heatRiskLevel: string;
    fetchedAt: string;
  } | null;
}

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  revokedAt: string | null;
  createdAt: string;
}

export default function IngestPage() {
  const qc = useQueryClient();
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // CSV / Takeout state
  const [importFormat, setImportFormat] = useState<'csv' | 'takeout_json'>('csv');
  const [rawText, setRawText] = useState(
    'timestamp,metric,value,unit,context\n2026-11-24T06:00:00Z,resting_heart_rate,66,bpm,sleep\n2026-11-24T06:05:00Z,spo2,97,%,sleep',
  );
  const [tsCol, setTsCol] = useState('timestamp');
  const [metricCol, setMetricCol] = useState('metric');
  const [valCol, setValCol] = useState('value');
  const [unitCol, setUnitCol] = useState('unit');

  // API key state
  const [keyName, setKeyName] = useState('Garry Watch Bridge');
  const [newKeySecret, setNewKeySecret] = useState<string | null>(null);

  // Synthetic sim state
  const [scenario, setScenario] = useState('early_infection');

  const qualityQuery = useQuery<QualityStatusResponse>({
    queryKey: ['quality-status'],
    queryFn: async () => {
      const res = await fetch('/api/v1/quality/status');
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const keysQuery = useQuery<{ keys: ApiKeyRow[] }>({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const res = await fetch('/api/v1/api-keys');
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const uploadXmlMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/v1/import/apple-xml', { method: 'POST', body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Apple XML import failed');
      return body;
    },
    onSuccess: (data) => {
      setErrorMsg(null);
      setStatusMsg(
        `Apple Health XML imported: ${data.ingest.recordsAccepted} samples persisted (${data.xmlStats.skipped} skipped).`,
      );
      qc.invalidateQueries({ queryKey: ['quality-status'] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'XML import failed'),
  });

  const csvImportMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/import/csv-takeout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          format: importFormat,
          content: rawText,
          mapping:
            importFormat === 'csv'
              ? {
                  timestampColumn: tsCol,
                  metricColumn: metricCol,
                  valueColumn: valCol,
                  unitColumn: unitCol,
                }
              : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Import failed');
      return body;
    },
    onSuccess: (data) => {
      setErrorMsg(null);
      setStatusMsg(`Imported ${data.ingest.recordsAccepted} samples via ${importFormat}.`);
      qc.invalidateQueries({ queryKey: ['quality-status'] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Import failed'),
  });

  const createKeyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: keyName }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Key creation failed');
      return body as { plaintextOnce: string };
    },
    onSuccess: (data) => {
      setErrorMsg(null);
      setNewKeySecret(data.plaintextOnce);
      setStatusMsg('Device ingestion API key created.');
      qc.invalidateQueries({ queryKey: ['api-keys'] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to create key'),
  });

  const simMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/sim/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scenario, seed: 42, totalDays: 16 }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Synthetic generation failed');
      return body;
    },
    onSuccess: (data) => {
      setErrorMsg(null);
      setStatusMsg(
        `SYNTHETIC scenario "${data.scenario}" ingested (${data.ingest.recordsAccepted} samples via ${data.engineSource}).`,
      );
      qc.invalidateQueries({ queryKey: ['quality-status'] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Simulation failed'),
  });

  const envMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/context/environment', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Weather lookup failed');
      return body;
    },
    onSuccess: () => {
      setErrorMsg(null);
      setStatusMsg('Updated ambient heat & air quality context via Open-Meteo (zero PII).');
      qc.invalidateQueries({ queryKey: ['quality-status'] });
    },
    onError: (err) => setErrorMsg(err instanceof Error ? err.message : 'Weather fetch failed'),
  });

  function onAppleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      uploadXmlMutation.mutate(file);
    }
  }

  function onCsvSubmit(e: FormEvent) {
    e.preventDefault();
    csvImportMutation.mutate();
  }

  const isUnauth = qualityQuery.error?.message === '401';
  const hasSynthetic = (qualityQuery.data?.counts.syntheticSamples ?? 0) > 0;

  return (
    <div className="min-h-dvh bg-[var(--bg-base)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
            <Link
              href="/"
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg border border-[var(--border-subtle)] px-3 text-sm font-medium hover:bg-[var(--bg-elevated)]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Home</span>
            </Link>
            <h1 className="font-[family-name:var(--font-display)] text-lg font-semibold sm:text-xl">
              Wearable Data Ingestion & Quality Pipeline
            </h1>
            {hasSynthetic && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--status-synthetic-bg)] px-3 py-1 text-xs font-bold text-[var(--status-synthetic)]">
                <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
                SYNTHETIC
              </span>
            )}
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        {isUnauth ? (
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
            <Lock className="mx-auto h-8 w-8 text-[var(--brand-primary)]" aria-hidden="true" />
            <h2 className="mt-3 text-xl font-semibold">Sign in required to import wearable data</h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Sign in as Ramesh Pai or a consented care-circle member to upload exports or run
              simulations.
            </p>
            <Link
              href="/auth"
              className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-[var(--brand-primary)] px-5 font-semibold text-[var(--brand-primary-fg)]"
            >
              Sign In
            </Link>
          </div>
        ) : (
          <>
            {statusMsg && (
              <div
                role="status"
                className="rounded-xl border border-[var(--status-stable)] bg-[var(--status-stable-bg)] p-4 text-sm font-medium text-[var(--status-stable)]"
              >
                {statusMsg}
              </div>
            )}
            {errorMsg && (
              <div
                role="alert"
                className="rounded-xl border border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] p-4 text-sm font-medium text-[var(--status-urgent)]"
              >
                {errorMsg}
              </div>
            )}

            <section
              aria-label="Quality Metrics Overview"
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
                  <Activity className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
                  <span>Stored Samples</span>
                </div>
                <p className="mt-2 font-[family-name:var(--font-mono)] text-2xl font-semibold tabular-nums">
                  {qualityQuery.data?.counts.totalSamples ?? 0}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {qualityQuery.data?.hourlyRollupCount ?? 0} hourly rollups
                </p>
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
                  <Radio className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
                  <span>Device Silence Monitor</span>
                </div>
                <p className="mt-2 font-[family-name:var(--font-mono)] text-2xl font-semibold tabular-nums">
                  {qualityQuery.data?.silence.hoursSilent !== null &&
                  qualityQuery.data?.silence.hoursSilent !== undefined
                    ? `${qualityQuery.data.silence.hoursSilent}h`
                    : 'No Data'}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {qualityQuery.data?.silence.isSilent
                    ? `Alert: silent >= ${qualityQuery.data.silence.thresholdHours}h`
                    : `7d wear ratio: ${Math.round((qualityQuery.data?.silence.wearRatio7d ?? 0) * 100)}%`}
                </p>
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)]">
                  <ShieldAlert className="h-4 w-4 text-[var(--status-watch)]" aria-hidden="true" />
                  <span>Motion Artifact Flags</span>
                </div>
                <p className="mt-2 font-[family-name:var(--font-mono)] text-2xl font-semibold tabular-nums">
                  {qualityQuery.data?.counts.motionArtifacts ?? 0}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  Confidence discounted during step bursts
                </p>
              </div>

              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-muted)]">
                  <span className="inline-flex items-center gap-1.5">
                    <CloudSun className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
                    <span>Ambient Heat (Open-Meteo)</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => envMutation.mutate()}
                    className="rounded px-2 py-0.5 text-xs font-semibold text-[var(--brand-accent-text)] hover:bg-[var(--bg-elevated)] cursor-pointer"
                  >
                    Refresh
                  </button>
                </div>
                <p className="mt-2 font-[family-name:var(--font-mono)] text-2xl font-semibold tabular-nums">
                  {qualityQuery.data?.environment
                    ? `${qualityQuery.data.environment.apparentTempC.toFixed(1)}°C`
                    : 'Not fetched'}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {qualityQuery.data?.environment
                    ? `${qualityQuery.data.environment.city} · ${qualityQuery.data.environment.humidityPct}% RH`
                    : 'District-rounded coords only'}
                </p>
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* Apple Health XML & Synthetic Generator */}
              <section className="min-w-0 space-y-6">
                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
                  <div className="flex items-center gap-2">
                    <FileUp className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                    <h2 className="text-lg font-semibold">Apple Health Streaming XML Importer</h2>
                  </div>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    Streams `export.xml` chunks without buffering the whole DOM; normalizes
                    HealthKit 0–1 SpO₂ fractions and °F temperatures automatically.
                  </p>
                  <label
                    htmlFor="apple-xml-input"
                    className="mt-4 flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-4 py-3 text-sm font-semibold hover:border-[var(--brand-primary)]"
                  >
                    <span>
                      {uploadXmlMutation.isPending
                        ? 'Streaming & parsing XML...'
                        : 'Choose Apple Health export.xml'}
                    </span>
                    <input
                      id="apple-xml-input"
                      type="file"
                      accept=".xml,text/xml"
                      onChange={onAppleFileChange}
                      className="sr-only"
                    />
                  </label>
                </div>

                <div className="rounded-2xl border border-[var(--status-synthetic)] bg-[var(--bg-surface)] p-6">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FlaskConical
                        className="h-5 w-5 text-[var(--status-synthetic)]"
                        aria-hidden="true"
                      />
                      <h2 className="text-lg font-semibold">Synthetic Physiological Scenario Mode</h2>
                    </div>
                    <span className="rounded-full bg-[var(--status-synthetic-bg)] px-2.5 py-0.5 text-xs font-bold text-[var(--status-synthetic)]">
                      SYNTHETIC
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    Generates seeded multi-day series with ground-truth onset times. All rows are
                    tagged `is_synthetic=true`.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <label htmlFor="sim-scenario" className="sr-only">
                      Scenario
                    </label>
                    <select
                      id="sim-scenario"
                      value={scenario}
                      onChange={(e) => setScenario(e.target.value)}
                      className="min-h-11 w-full min-w-0 sm:flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm"
                    >
                      <option value="baseline_stable">Baseline Stable (Healthy 16d)</option>
                      <option value="early_infection">Early Infection / Febrile Prodrome</option>
                      <option value="hf_decompensation">Heart Failure Decompensation</option>
                      <option value="copd_exacerbation">COPD Exacerbation (Scale 2)</option>
                      <option value="arrhythmia_episode">Arrhythmia / AFib Episode</option>
                      <option value="dehydration_heat">Dehydration & Heat Stress</option>
                      <option value="post_discharge_decline">Post-Discharge Decline</option>
                      <option value="missed_medication">Missed Medication Rebound</option>
                      <option value="fall_event">Fall Event + Inactivity</option>
                      <option value="exercise_confounder">Exercise Confounder (Must Not Alert)</option>
                      <option value="off_wrist_silence">Off-Wrist Device Silence (18h)</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => simMutation.mutate()}
                      disabled={simMutation.isPending}
                      className="min-h-11 rounded-xl bg-[var(--status-synthetic)] px-4 text-sm font-semibold text-white cursor-pointer"
                    >
                      {simMutation.isPending ? 'Generating...' : 'Generate Synthetic Series'}
                    </button>
                  </div>
                </div>
              </section>

              {/* CSV Column Mapper / Takeout + API Keys */}
              <section className="min-w-0 space-y-6">
                <form
                  onSubmit={onCsvSubmit}
                  className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <FileSpreadsheet
                        className="h-5 w-5 shrink-0 text-[var(--brand-primary)]"
                        aria-hidden="true"
                      />
                      <h2 className="text-lg font-semibold">CSV Column Mapper & Takeout Import</h2>
                    </div>
                    <select
                      aria-label="Import format"
                      value={importFormat}
                      onChange={(e) => setImportFormat(e.target.value as 'csv' | 'takeout_json')}
                      className="min-h-10 max-w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 text-xs font-semibold"
                    >
                      <option value="csv">Generic CSV</option>
                      <option value="takeout_json">Google / Fitbit Takeout JSON</option>
                    </select>
                  </div>

                  {importFormat === 'csv' && (
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <input
                        aria-label="Timestamp column"
                        value={tsCol}
                        onChange={(e) => setTsCol(e.target.value)}
                        placeholder="timestamp"
                        className="min-h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 text-xs"
                      />
                      <input
                        aria-label="Metric column"
                        value={metricCol}
                        onChange={(e) => setMetricCol(e.target.value)}
                        placeholder="metric"
                        className="min-h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 text-xs"
                      />
                      <input
                        aria-label="Value column"
                        value={valCol}
                        onChange={(e) => setValCol(e.target.value)}
                        placeholder="value"
                        className="min-h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 text-xs"
                      />
                      <input
                        aria-label="Unit column"
                        value={unitCol}
                        onChange={(e) => setUnitCol(e.target.value)}
                        placeholder="unit"
                        className="min-h-10 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 text-xs"
                      />
                    </div>
                  )}

                  <label htmlFor="csv-takeout-text" className="sr-only">
                    CSV or Takeout JSON payload
                  </label>
                  <textarea
                    id="csv-takeout-text"
                    rows={4}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    className="mt-3 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 font-[family-name:var(--font-mono)] text-xs"
                  />
                  <button
                    type="submit"
                    disabled={csvImportMutation.isPending}
                    className="mt-3 min-h-11 rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-[var(--brand-primary-fg)] cursor-pointer"
                  >
                    {csvImportMutation.isPending ? 'Importing...' : 'Import Mapped Records'}
                  </button>
                </form>

                <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                    <h2 className="text-lg font-semibold">Open Ingestion API Keys & Live Adapters</h2>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <label htmlFor="new-key-name" className="sr-only">
                      Device key name
                    </label>
                    <input
                      id="new-key-name"
                      value={keyName}
                      onChange={(e) => setKeyName(e.target.value)}
                      className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => createKeyMutation.mutate()}
                      className="min-h-11 rounded-lg bg-[var(--brand-primary)] px-4 text-sm font-semibold text-[var(--brand-primary-fg)] cursor-pointer"
                    >
                      Generate Key
                    </button>
                  </div>

                  {newKeySecret && (
                    <div className="mt-3 break-all rounded-lg border border-[var(--status-watch)] bg-[var(--status-watch-bg)] p-3 font-[family-name:var(--font-mono)] text-xs text-[var(--text-primary)]">
                      Copy now (shown once): <strong>{newKeySecret}</strong>
                    </div>
                  )}

                  <ul className="mt-3 space-y-2 text-xs">
                    {(keysQuery.data?.keys ?? []).map((k) => (
                      <li
                        key={k.id}
                        className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] px-3 py-2"
                      >
                        <span className="font-semibold">{k.name}</span>
                        <span className="font-[family-name:var(--font-mono)] text-[var(--text-muted)]">
                          {k.keyPrefix}…
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-4 space-y-2 border-t border-[var(--border-subtle)] pt-3 text-xs">
                    {(qualityQuery.data?.adapters ?? []).map((a) => (
                      <div key={a.provider} className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{a.provider}</span>
                        <span className="text-[var(--text-muted)]">{a.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>

            <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
              <h2 className="text-lg font-semibold">Recent Ingestion Batches (Provenance Ledger)</h2>
              <div
                tabIndex={0}
                role="region"
                aria-label="Recent ingestion batches"
                className="mt-3 overflow-x-auto"
              >
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
                      <th className="py-2 pr-4">Source</th>
                      <th className="py-2 pr-4">Received</th>
                      <th className="py-2 pr-4">Accepted</th>
                      <th className="py-2 pr-4">Skipped</th>
                      <th className="py-2">Mode</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {(qualityQuery.data?.batches ?? []).map((b) => (
                      <tr key={b.id}>
                        <td className="py-2 pr-4 font-[family-name:var(--font-mono)] text-xs">
                          {b.source}
                        </td>
                        <td className="py-2 pr-4 tabular-nums">{b.recordsReceived}</td>
                        <td className="py-2 pr-4 tabular-nums">{b.recordsAccepted}</td>
                        <td className="py-2 pr-4 tabular-nums">{b.recordsSkipped}</td>
                        <td className="py-2">
                          {b.isSynthetic ? (
                            <span className="rounded-full bg-[var(--status-synthetic-bg)] px-2 py-0.5 text-xs font-bold text-[var(--status-synthetic)]">
                              SYNTHETIC
                            </span>
                          ) : (
                            <span className="rounded-full bg-[var(--status-stable-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--status-stable)]">
                              Real Import
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {(qualityQuery.data?.batches.length ?? 0) === 0 && (
                      <tr>
                        <td colSpan={5} className="py-4 text-center text-[var(--text-muted)]">
                          No batches ingested yet. Upload Apple Health XML, CSV, or run Synthetic
                          mode above.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
