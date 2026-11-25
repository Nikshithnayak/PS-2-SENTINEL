'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BarChart3, BookOpen, Database, FlaskConical, Lock, Play } from 'lucide-react';
import { SentinelNav } from '@/components/sentinel-nav';

interface BenchmarkResult {
  datasetMode: string;
  isSynthetic: boolean;
  seedsTested: number[];
  scenarioCount: number;
  ablations: Record<
    string,
    {
      truePositives: number;
      falsePositives: number;
      falseNegatives: number;
      trueNegatives: number;
      sensitivity: number;
      specificity: number;
      ppv: number;
      falseAlertsPerPatientWeek: number;
      medianHoursAfterOnset: number | null;
    }
  >;
  scenarios: Array<{
    scenario: string;
    seed: number;
    expectedLevel: string;
    observedFinalLevel: string;
    peakIndexFull: number;
    peakIndexFixed: number;
    detectedFull: boolean;
    detectedFixed: boolean;
    hoursAfterOnsetFull: number | null;
  }>;
  notes: string;
}

interface DatasetsResponse {
  datasets: Record<
    string,
    {
      name: string;
      format: string;
      license: string;
      metrics: string;
    }
  >;
}

export default function EvaluationLabPage() {
  const [benchResult, setBenchResult] = useState<BenchmarkResult | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const datasetsQuery = useQuery<DatasetsResponse>({
    queryKey: ['datasets-catalog'],
    queryFn: async () => {
      const res = await fetch('/api/v1/datasets');
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/engine/benchmark', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ seeds: [42], totalDays: 16, includeAblations: true }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Benchmark run failed');
      return body as BenchmarkResult;
    },
    onSuccess: (data) => {
      setErrMsg(null);
      setBenchResult(data);
    },
    onError: (err) => setErrMsg(err instanceof Error ? err.message : 'Benchmark failed'),
  });

  const isUnauth = datasetsQuery.error?.message === '401';

  return (
    <div className="min-h-dvh bg-[var(--bg-base)] text-[var(--text-primary)]">
      <SentinelNav
        title="Evaluation Lab & Ablations"
        isSynthetic={Boolean(benchResult?.isSynthetic)}
        rightSlot={
          <Link
            href="/model-card"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-3 text-xs font-semibold hover:bg-[var(--bg-elevated)]"
          >
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            <span>Model Card</span>
          </Link>
        }
      />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
        {isUnauth ? (
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
            <Lock className="mx-auto h-8 w-8 text-[var(--brand-primary)]" aria-hidden="true" />
            <h2 className="mt-3 text-xl font-semibold">Sign in to run Evaluation Lab</h2>
            <Link
              href="/auth"
              className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-[var(--brand-primary)] px-5 font-semibold text-[var(--brand-primary-fg)]"
            >
              Sign In
            </Link>
          </div>
        ) : (
          <>
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
              <div>
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                  <h2 className="text-lg font-semibold">Causal Walk-Forward Benchmark Harness</h2>
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--status-synthetic-bg)] px-2.5 py-0.5 text-xs font-bold text-[var(--status-synthetic)]">
                    <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
                    SYNTHETIC
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Measures Sensitivity, Specificity, PPV, False Alerts / Patient-Week, and Median
                  Detection Latency strictly without future lookahead across all 11 physiological
                  scenarios. Reports raw observed results honestly.
                </p>
              </div>
              <button
                type="button"
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-5 text-sm font-semibold text-[var(--brand-primary-fg)] cursor-pointer"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                <span>{runMutation.isPending ? 'Running Causal Benchmark...' : 'Run Live Ablation Benchmark'}</span>
              </button>
            </section>

            {errMsg && (
              <div
                role="alert"
                className="rounded-xl border border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] px-4 py-3 text-sm text-[var(--status-urgent)]"
              >
                {errMsg}
              </div>
            )}

            {benchResult && (
              <>
                <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
                  <h2 className="text-lg font-semibold">Ablation Comparison (Measured Live)</h2>
                  <div
                    tabIndex={0}
                    role="region"
                    aria-label="Ablation benchmark comparison"
                    className="mt-3 overflow-x-auto"
                  >
                    <table className="w-full text-left text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
                          <th className="py-2 pr-3">Detector Variant</th>
                          <th className="py-2 pr-3">Sensitivity</th>
                          <th className="py-2 pr-3">Specificity</th>
                          <th className="py-2 pr-3">PPV</th>
                          <th className="py-2 pr-3">FA / Patient-Wk</th>
                          <th className="py-2">Median Latency (h post-onset)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)] font-[family-name:var(--font-mono)]">
                        {Object.entries(benchResult.ablations).map(([variant, m]) => (
                          <tr key={variant}>
                            <td className="py-2 pr-3 font-semibold">{variant}</td>
                            <td className="py-2 pr-3">{(m.sensitivity * 100).toFixed(1)}%</td>
                            <td className="py-2 pr-3">{(m.specificity * 100).toFixed(1)}%</td>
                            <td className="py-2 pr-3">{(m.ppv * 100).toFixed(1)}%</td>
                            <td className="py-2 pr-3">{m.falseAlertsPerPatientWeek}</td>
                            <td className="py-2">{m.medianHoursAfterOnset ?? '—'}h</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
                  <h2 className="text-lg font-semibold">Per-Scenario Outcomes (11 Seeded Scenarios)</h2>
                  <div
                    tabIndex={0}
                    role="region"
                    aria-label="Per scenario evaluation breakdown"
                    className="mt-3 overflow-x-auto"
                  >
                    <table className="w-full text-left text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border-subtle)] text-xs text-[var(--text-muted)]">
                          <th className="py-2 pr-3">Scenario</th>
                          <th className="py-2 pr-3">Expected</th>
                          <th className="py-2 pr-3">Observed</th>
                          <th className="py-2 pr-3">Peak Full Index</th>
                          <th className="py-2 pr-3">Peak Fixed Index</th>
                          <th className="py-2">Latency (h)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border-subtle)] font-[family-name:var(--font-mono)]">
                        {benchResult.scenarios.map((s) => (
                          <tr key={`${s.scenario}-${s.seed}`}>
                            <td className="py-2 pr-3 font-semibold">{s.scenario}</td>
                            <td className="py-2 pr-3">{s.expectedLevel}</td>
                            <td className="py-2 pr-3">{s.observedFinalLevel}</td>
                            <td className="py-2 pr-3">{s.peakIndexFull}</td>
                            <td className="py-2 pr-3">{s.peakIndexFixed}</td>
                            <td className="py-2">{s.hoursAfterOnsetFull ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}

            <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                <h2 className="text-lg font-semibold">Public Wearable Dataset Format Adapters</h2>
              </div>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Raw third-party clinical/public dataset archives are externally hosted per upstream
                license (`_data/&lt;dataset&gt;/`); SENTINEL includes deterministic schema adapters in
                `services/engine/engine/datasets/loaders.py`.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {Object.entries(datasetsQuery.data?.datasets ?? {}).map(([key, d]) => (
                  <div
                    key={key}
                    className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs"
                  >
                    <p className="font-semibold">{d.name}</p>
                    <p className="mt-1 text-[var(--text-muted)]">{d.format}</p>
                    <p className="mt-1 font-[family-name:var(--font-mono)] text-[11px]">
                      License: {d.license}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
