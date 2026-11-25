'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Download, Lock, Printer } from 'lucide-react';
import { SentinelNav } from '@/components/sentinel-nav';

interface ClinicalReportData {
  patientId: string;
  displayCode: string;
  patientName: string;
  ageBand: string;
  conditionModules: string[];
  isSynthetic: boolean;
  latestAssessment: {
    assessedAt: string;
    deteriorationIndex: number;
    level: string;
    l1Score: number;
    l2Score: number;
    l3Score: number;
    explanationEn: string;
    contributions: Array<{
      label: string;
      observed: number;
      normalLow: number;
      normalHigh: number;
      unit: string;
      sharePct: number;
    }>;
    partialNews2: {
      partialScore: number;
      scoredParameterCount: number;
      parameters: Array<{
        parameter: string;
        observedValue: number | null;
        points: number | null;
        status: string;
      }>;
    } | null;
  } | null;
  medications: Array<{ name: string; dosage: string; scheduleTimes: string[] }>;
}

export default function ClinicianReportPage() {
  const query = useQuery<ClinicalReportData>({
    queryKey: ['dashboard-patient-report'],
    queryFn: async () => {
      const res = await fetch('/api/v1/dashboard/patient');
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const isUnauth = query.error?.message === '401';

  return (
    <div className="min-h-dvh bg-[var(--bg-base)] text-[var(--text-primary)]">
      <div className="print:hidden">
        <SentinelNav title="Printable Clinical Summary" isSynthetic={query.data?.isSynthetic} />
      </div>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        {isUnauth ? (
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
            <Lock className="mx-auto h-8 w-8 text-[var(--brand-primary)]" aria-hidden="true" />
            <h2 className="mt-3 text-xl font-semibold">Sign in to view Clinician Summary</h2>
            <Link
              href="/auth"
              className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-[var(--brand-primary)] px-5 font-semibold text-[var(--brand-primary-fg)]"
            >
              Sign In
            </Link>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 text-sm font-semibold text-[var(--brand-primary-fg)] cursor-pointer"
                >
                  <Printer className="h-4 w-4" aria-hidden="true" />
                  <span>Print / Save as PDF</span>
                </button>
                <a
                  href={`/api/v1/export/fhir?patientId=${query.data?.patientId ?? ''}`}
                  download
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 text-sm font-semibold"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span>Download FHIR R4 Bundle</span>
                </a>
              </div>
              <Link href="/clinician" className="text-sm underline">
                Back to Clinician View
              </Link>
            </div>

            <article className="space-y-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8">
              <header className="border-b border-[var(--border-subtle)] pb-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold">
                    Sachet · SENTINEL Longitudinal Telemetry Summary
                  </h2>
                  {query.data?.isSynthetic && (
                    <span className="rounded-full border border-[var(--status-synthetic)] px-2.5 py-0.5 text-xs font-bold text-[var(--status-synthetic)]">
                      SYNTHETIC SIMULATION
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-[var(--text-muted)]">
                  Patient: <strong>{query.data?.patientName ?? '—'}</strong> (
                  {query.data?.displayCode ?? '—'}) · Age Band: {query.data?.ageBand ?? '—'} ·
                  Conditions: {(query.data?.conditionModules ?? []).join(', ')}
                </p>
              </header>

              <section>
                <h3 className="text-base font-semibold">Latest Early-Awareness Assessment</h3>
                <p className="mt-1 font-[family-name:var(--font-mono)] text-sm">
                  Deterioration Index:{' '}
                  <strong>{query.data?.latestAssessment?.deteriorationIndex ?? 0}</strong> (
                  {query.data?.latestAssessment?.level ?? 'stable'}) · L1/L2/L3:{' '}
                  {query.data?.latestAssessment?.l1Score ?? 0} /{' '}
                  {query.data?.latestAssessment?.l2Score ?? 0} /{' '}
                  {query.data?.latestAssessment?.l3Score ?? 0}
                </p>
                <p className="mt-2 text-sm">{query.data?.latestAssessment?.explanationEn}</p>
              </section>

              <section>
                <h3 className="text-base font-semibold">Signal Deviations vs Personal Normal</h3>
                <table className="mt-2 w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)]">
                      <th className="py-1.5 pr-3">Signal</th>
                      <th className="py-1.5 pr-3">Observed</th>
                      <th className="py-1.5 pr-3">Personal Normal</th>
                      <th className="py-1.5">Weight %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)] font-[family-name:var(--font-mono)]">
                    {(query.data?.latestAssessment?.contributions ?? []).map((c) => (
                      <tr key={c.label}>
                        <td className="py-1.5 pr-3">{c.label}</td>
                        <td className="py-1.5 pr-3">
                          {c.observed} {c.unit}
                        </td>
                        <td className="py-1.5 pr-3">
                          {c.normalLow}–{c.normalHigh} {c.unit}
                        </td>
                        <td className="py-1.5">{c.sharePct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section>
                <h3 className="text-base font-semibold">Partial NEWS2 Parameters</h3>
                <p className="text-xs text-[var(--text-muted)]">
                  Score: {query.data?.latestAssessment?.partialNews2?.partialScore ?? 0} pts (
                  {query.data?.latestAssessment?.partialNews2?.scoredParameterCount ?? 0}/7 params)
                </p>
                <ul className="mt-2 space-y-1 font-[family-name:var(--font-mono)] text-xs">
                  {(query.data?.latestAssessment?.partialNews2?.parameters ?? []).map((p) => (
                    <li key={p.parameter}>
                      {p.parameter}: {p.observedValue ?? '—'} · pts={p.points ?? 'N/A'} ({p.status})
                    </li>
                  ))}
                </ul>
              </section>

              <footer className="border-t border-[var(--border-subtle)] pt-4 text-xs text-[var(--text-muted)]">
                Disclaimer: Screening &amp; early-awareness wearable telemetry summary. Not a
                diagnostic instrument. Clinical correlation required.
              </footer>
            </article>
          </>
        )}
      </main>
    </div>
  );
}
