'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  BellRing,
  Bluetooth,
  CheckCircle2,
  Eye,
  HeartPulse,
  HelpCircle,
  PhoneCall,
  Pill,
  Volume2,
  Wind,
} from 'lucide-react';
import { VitalsChart, type VitalsChartPoint } from '@/components/charts/vitals-chart';
import { ActivityRingCard } from '@/components/health/activity-ring-card';
import { RoleWorkspaceGuard } from '@/components/health/role-gate';
import { SignedOutGate } from '@/components/health/signed-out-gate';
import { SleepQualityCard } from '@/components/health/sleep-quality-card';
import { StatusBadge } from '@/components/health/status-badge';
import { useBleWatch } from '@/components/ingest/ble-watch-provider';
import { SentinelShell } from '@/components/sentinel-shell';
import { VoiceCheckinCompanion } from '@/components/voice/voice-checkin';

interface PatientDashboardData {
  patientId: string;
  patientFirstName: string;
  locale: 'en' | 'kn' | 'hi';
  emergencyNumber: string;
  ambulanceNumber: string;
  city?: string;
  isSynthetic: boolean;
  silence: {
    hoursSilent: number | null;
    isSilent: boolean;
    wearRatio7d?: number;
  };
  latestAssessment: {
    assessedAt: string;
    deteriorationIndex: number;
    level: 'stable' | 'watch' | 'warning' | 'urgent';
    explanationEn: string;
    explanationKn: string | null;
    explanationHi: string | null;
    contributions: Array<{
      metricType: string;
      label: string;
      observed: number;
      normalLow: number;
      normalHigh: number;
      unit: string;
      message: string;
    }>;
  } | null;
  baselines: Array<{
    status: string;
    validDays: number;
  }>;
  alerts?: Array<{
    id: string;
    level: string;
    status: string;
    summaryEn: string;
    escalationStep: number;
    createdAt: string;
    isSynthetic: boolean;
  }>;
  checkins: Array<{
    id: string;
    kind: string;
    severity: string;
    recordedAt: string;
  }>;
  medications: Array<{
    id: string;
    name: string;
    dosage: string;
    scheduleTimes: string[];
    affectsHeartRate: boolean;
  }>;
}

interface SeriesResponse {
  metricType: string;
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
  hasOlderSamples?: boolean;
  latestAvailableAt?: string | null;
}

const COPY = {
  en: {
    greeting: 'Hello',
    stableTitle: 'All readings look steady today',
    watchTitle: 'Small changes from your normal',
    warningTitle: 'Noticeable changes from your normal',
    urgentTitle: 'Important health check needed now',
    feelOkay: 'I Feel Okay',
    notWell: 'Not Feeling Well',
    whyBtn: 'Why am I seeing this?',
    readAloud: 'Read Aloud',
    callEmergency: 'Emergency Help',
  },
  kn: {
    greeting: 'ನಮಸ್ಕಾರ',
    stableTitle: 'ಇಂದಿನ ಎಲ್ಲಾ ಮಾಪನಗಳು ಸ್ಥಿರವಾಗಿವೆ',
    watchTitle: 'ನಿಮ್ಮ ಸಾಮಾನ್ಯ ಮಟ್ಟದಲ್ಲಿ ಸಣ್ಣ ಬದಲಾವಣೆ',
    warningTitle: 'ನಿಮ್ಮ ಸಾಮಾನ್ಯ ಮಟ್ಟಕ್ಕಿಂತ ಬದಲಾವಣೆ ಕಂಡುಬಂದಿದೆ',
    urgentTitle: 'ತಕ್ಷಣ ಆರೋಗ್ಯ ತಪಾಸಣೆ ಅಗತ್ಯವಿದೆ',
    feelOkay: 'ನಾನು ಚೆನ್ನಾಗಿದ್ದೇನೆ',
    notWell: 'ಆರೋಗ್ಯ ಸರಿ ಇಲ್ಲ',
    whyBtn: 'ಇದು ಏಕೆ ತೋರಿಸುತ್ತಿದೆ?',
    readAloud: 'ಗಟ್ಟಿಯಾಗಿ ಓದಿ',
    callEmergency: 'ತುರ್ತು ಸಹಾಯ',
  },
  hi: {
    greeting: 'नमस्ते',
    stableTitle: 'आज सभी माप सामान्य लग रहे हैं',
    watchTitle: 'आपके सामान्य स्तर से हल्का बदलाव',
    warningTitle: 'आपके सामान्य स्तर से स्पष्ट बदलाव',
    urgentTitle: 'अभी तुरंत स्वास्थ्य जांच आवश्यक है',
    feelOkay: 'मैं ठीक हूँ',
    notWell: 'तबीयत ठीक नहीं है',
    whyBtn: 'यह क्यों दिख रहा है?',
    readAloud: 'ज़ोर से सुनें',
    callEmergency: 'आपातकालीन सहायता',
  },
};

const TREND_METRICS = [
  { id: 'resting_heart_rate', label: 'Heart Rate', unit: 'bpm' },
  { id: 'spo2', label: 'SpO₂', unit: '%' },
  { id: 'respiratory_rate', label: 'Breathing', unit: '/min' },
  { id: 'hrv_rmssd', label: 'HRV', unit: 'ms' },
] as const;

export default function PatientTodayPage() {
  const qc = useQueryClient();
  const {
    bleStatus,
    watchName,
    batteryPct,
    liveBpm,
    liveSpo2,
    liveHrv,
    bufferedCount,
    autoSavedCount,
    syncingBle,
    disconnectBleWatch,
    flushBleSamples,
  } = useBleWatch();
  const [lang, setLang] = useState<'en' | 'kn' | 'hi'>('en');
  const [chartMetric, setChartMetric] = useState<string>('resting_heart_rate');
  const [chartWindow, setChartWindow] = useState<'24h' | '7d' | '30d'>('7d');
  const [autoWidened, setAutoWidened] = useState(false);
  const [showWhy, setShowWhy] = useState(false);
  const [showSymptoms, setShowSymptoms] = useState(false);
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [checkinMsg, setCheckinMsg] = useState<string | null>(null);

  const query = useQuery<PatientDashboardData>({
    queryKey: ['dashboard-patient'],
    queryFn: async () => {
      const res = await fetch('/api/v1/dashboard/patient');
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const patientId = query.data?.patientId;
  const fetchSeries = async (metric: string, win: '24h' | '7d' | '30d' = '7d'): Promise<SeriesResponse> => {
    const res = await fetch(
      `/api/v1/vitals/series?patientId=${patientId}&metric=${metric}&window=${win}`,
    );
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
  };

  const rhrQuery = useQuery<SeriesResponse>({
    queryKey: ['today-series', patientId, 'resting_heart_rate', chartWindow],
    enabled: Boolean(patientId),
    queryFn: () => fetchSeries('resting_heart_rate', chartWindow),
  });

  const spo2Query = useQuery<SeriesResponse>({
    queryKey: ['today-series', patientId, 'spo2', chartWindow],
    enabled: Boolean(patientId),
    queryFn: () => fetchSeries('spo2', chartWindow),
  });

  const stepsQuery = useQuery<SeriesResponse>({
    queryKey: ['today-series', patientId, 'steps'],
    enabled: Boolean(patientId),
    queryFn: () => fetchSeries('steps', '7d'),
  });

  const sleepDurQuery = useQuery<SeriesResponse>({
    queryKey: ['today-series', patientId, 'sleep_duration_min', '30d'],
    enabled: Boolean(patientId),
    queryFn: () => fetchSeries('sleep_duration_min', '30d'),
  });

  const sleepEffQuery = useQuery<SeriesResponse>({
    queryKey: ['today-series', patientId, 'sleep_efficiency', '30d'],
    enabled: Boolean(patientId),
    queryFn: () => fetchSeries('sleep_efficiency', '30d'),
  });

  const selectedChartQuery = useQuery<SeriesResponse>({
    queryKey: ['today-series', patientId, chartMetric, chartWindow],
    enabled: Boolean(patientId),
    queryFn: () => fetchSeries(chartMetric, chartWindow),
  });

  useEffect(() => {
    if (
      !autoWidened &&
      chartWindow === '7d' &&
      selectedChartQuery.data &&
      selectedChartQuery.data.points.length === 0 &&
      selectedChartQuery.data.hasOlderSamples
    ) {
      setAutoWidened(true);
      setChartWindow('30d');
    }
  }, [autoWidened, chartWindow, selectedChartQuery.data]);

  const checkinMutation = useMutation({
    mutationFn: async (vars: { kind: 'tap_ok' | 'tap_unwell'; symptoms?: string[] }) => {
      const res = await fetch('/api/v1/checkins', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          patientId: query.data?.patientId,
          kind: vars.kind,
          locale: lang,
          symptoms: vars.symptoms ?? [],
          severity: vars.kind === 'tap_ok' ? 'none' : 'moderate',
          isSynthetic: Boolean(query.data?.isSynthetic),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Check-in failed');
      return body;
    },
    onSuccess: (_, vars) => {
      setShowSymptoms(false);
      setSelectedSymptoms([]);
      setCheckinMsg(
        vars.kind === 'tap_ok'
          ? 'Saved: I feel okay today. Shared with your care circle.'
          : 'Saved: Care circle notified that you asked for support.',
      );
      qc.invalidateQueries({ queryKey: ['dashboard-patient'] });
    },
  });

  const medMutation = useMutation({
    mutationFn: async (vars: { medicationId: string; status: 'taken' | 'missed' }) => {
      const res = await fetch('/api/v1/medications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'log_dose',
          patientId: query.data?.patientId,
          medicationId: vars.medicationId,
          status: vars.status,
        }),
      });
      if (!res.ok) throw new Error('Medication log failed');
      return res.json();
    },
    onSuccess: (_, vars) => {
      setCheckinMsg(`Dose recorded as "${vars.status}".`);
      qc.invalidateQueries({ queryKey: ['dashboard-patient'] });
    },
  });

  const isUnauth = query.error?.message === '401';
  const level = query.data?.latestAssessment?.level ?? 'stable';
  const copy = COPY[lang];

  const statusMeta = {
    stable: {
      title: copy.stableTitle,
      Icon: CheckCircle2,
      boxClass: 'border-[var(--status-stable)] bg-[var(--status-stable-bg)]',
      textClass: 'text-[var(--status-stable)]',
    },
    watch: {
      title: copy.watchTitle,
      Icon: Eye,
      boxClass: 'border-[var(--status-watch)] bg-[var(--status-watch-bg)]',
      textClass: 'text-[var(--status-watch)]',
    },
    warning: {
      title: copy.warningTitle,
      Icon: AlertTriangle,
      boxClass: 'border-[var(--status-warning)] bg-[var(--status-warning-bg)]',
      textClass: 'text-[var(--status-warning)]',
    },
    urgent: {
      title: copy.urgentTitle,
      Icon: PhoneCall,
      boxClass: 'border-[var(--status-urgent)] bg-[var(--status-urgent-bg)]',
      textClass: 'text-[var(--status-urgent)]',
    },
  }[level];

  const StatusIcon = statusMeta.Icon;
  const localizedExplanation =
    lang === 'kn'
      ? query.data?.latestAssessment?.explanationKn || query.data?.latestAssessment?.explanationEn
      : lang === 'hi'
        ? query.data?.latestAssessment?.explanationHi || query.data?.latestAssessment?.explanationEn
        : query.data?.latestAssessment?.explanationEn;

  const summarySentence =
    localizedExplanation ??
    'No wearable summary calculated yet. Import watch data or check back once telemetry arrives.';

  function readAloud() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(`${statusMeta.title}. ${summarySentence}`);
    utter.lang = lang === 'kn' ? 'kn-IN' : lang === 'hi' ? 'hi-IN' : 'en-IN';
    utter.rate = 0.9;
    window.speechSynthesis.speak(utter);
  }

  const latestRhr = rhrQuery.data?.points[rhrQuery.data.points.length - 1];
  const latestSpo2 = spo2Query.data?.points[spo2Query.data.points.length - 1];
  const activeChartMeta = TREND_METRICS.find((m) => m.id === chartMetric) ?? TREND_METRICS[0];
  const recentAlerts = (query.data?.alerts ?? []).slice(0, 3);

  return (
    <SentinelShell
      title="Patient Today (Elder Mode)"
      subtitle={
        query.data
          ? `${copy.greeting}, ${query.data.patientFirstName} · ${query.data.city ?? 'Home Care'}`
          : 'Calm daily overview in plain language'
      }
      isSynthetic={query.data?.isSynthetic}
      rightSlot={
        <div
          className="flex items-center gap-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-1"
          role="group"
          aria-label="Language selector"
        >
          {(['en', 'kn', 'hi'] as const).map((code) => (
            <button
              key={code}
              type="button"
              onClick={() => setLang(code)}
              className={`min-h-10 rounded-lg px-3 text-sm font-bold transition cursor-pointer ${lang === code
                ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]'
                : 'text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                }`}
            >
              {code === 'en' ? 'EN' : code === 'kn' ? 'ಕನ್ನಡ' : 'हिन्दी'}
            </button>
          ))}
        </div>
      }
    >
      <main className="space-y-6 text-[18px]">
        <RoleWorkspaceGuard allowedRoles={['patient']} workspaceName="Patient Today (Elder Mode)">
        {isUnauth ? (
          <SignedOutGate heading="Sign in for Patient Today view" />
        ) : (
          <>
            {/* Top Calm Elder Greeting & Overall Status */}
            <section
              aria-label="Today's personal health status"
              className={`rounded-3xl border-2 p-6 sm:p-7 ${statusMeta.boxClass}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xl font-bold text-[var(--text-primary)]">
                    {copy.greeting}, {query.data?.patientFirstName ?? 'Friend'}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <StatusIcon className={`h-8 w-8 shrink-0 ${statusMeta.textClass}`} aria-hidden="true" />
                    <h2
                      className={`font-[family-name:var(--font-display)] text-2xl font-bold sm:text-3xl ${statusMeta.textClass}`}
                    >
                      {statusMeta.title}
                    </h2>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge level={level} size="md" />
                  <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-1.5 text-sm font-semibold">
                    {query.data?.baselines[0]
                      ? `Baseline: ${query.data.baselines[0].status} (${query.data.baselines[0].validDays}d)`
                      : 'Baseline: Learning'}
                  </span>
                </div>
              </div>

              <p className="mt-4 text-xl leading-relaxed text-[var(--text-primary)]">
                {summarySentence}
              </p>
              <p className="mt-1.5 text-sm text-[var(--text-muted)]">
                Early awareness only — changes from your personal normal, not a medical diagnosis.
              </p>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={readAloud}
                  className="inline-flex min-h-14 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 text-lg font-semibold hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  <Volume2 className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                  <span>{copy.readAloud}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowWhy((v) => !v)}
                  aria-expanded={showWhy}
                  className="inline-flex min-h-14 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 text-lg font-semibold hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  <HelpCircle className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                  <span>{copy.whyBtn}</span>
                </button>
              </div>

              {showWhy && (
                <div
                  data-testid="why-drawer"
                  className="clinical-card mt-5 space-y-3 p-5"
                >
                  <h3 className="text-lg font-semibold">What changed from your personal normal:</h3>
                  {(query.data?.latestAssessment?.contributions ?? []).length === 0 ? (
                    <p className="text-base text-[var(--text-muted)]">
                      Run a baseline check on Data Import or wear your watch to populate signal comparisons.
                    </p>
                  ) : (
                    <ul className="space-y-2.5 text-base">
                      {(query.data?.latestAssessment?.contributions ?? []).slice(0, 4).map((c) => (
                        <li
                          key={c.metricType}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3.5"
                        >
                          <span className="font-medium">{c.message}</span>
                          <span className="font-[family-name:var(--font-mono)] text-sm text-[var(--text-muted)]">
                            Normal: {c.normalLow}–{c.normalHigh} {c.unit}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>

            {/* 3-Column Bento Dashboard Grid inspired by Stitch Clinical Layout */}
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 items-start">
              {/* Column 1: Daily Activity & Sleep Quality */}
              <section
                aria-label="Daily activity and sleep"
                className="mint-bento space-y-5 p-4 sm:p-5 xl:col-span-4"
              >
                <div className="flex items-center justify-between px-1">
                  <h2 className="font-[family-name:var(--font-display)] text-lg font-bold">
                    Activity &amp; Sleep
                  </h2>
                  <Link
                    href="/signals"
                    className="text-sm font-semibold text-[var(--brand-accent-text)] hover:underline"
                  >
                    Full trends →
                  </Link>
                </div>

                <ActivityRingCard
                  points={stepsQuery.data?.points ?? []}
                  medianHourlySteps={stepsQuery.data?.baseline?.medianVal}
                  loading={stepsQuery.isLoading}
                />

                <SleepQualityCard
                  durationPoints={sleepDurQuery.data?.points ?? []}
                  efficiencyPoints={sleepEffQuery.data?.points ?? []}
                  durationMedian={sleepDurQuery.data?.baseline?.medianVal}
                  efficiencyMedian={sleepEffQuery.data?.baseline?.medianVal}
                  loading={sleepDurQuery.isLoading}
                />
              </section>

              {/* Column 2: Your Health Overview — 7-Day Trend, HR, SpO2 & Alerts */}
              <section
                aria-label="Your health overview"
                className="mint-bento space-y-5 p-4 sm:p-5 xl:col-span-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                  <h2 className="font-[family-name:var(--font-display)] text-lg font-bold">
                    Your Health Overview
                  </h2>
                  <div className="flex flex-wrap gap-1">
                    {TREND_METRICS.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setChartMetric(m.id)}
                        className={`min-h-9 rounded-lg px-2.5 text-xs font-semibold transition cursor-pointer ${chartMetric === m.id
                          ? 'bg-[var(--brand-rail-active)] text-[var(--brand-rail-active-fg)]'
                          : 'bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                          }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {(bleStatus === 'connected' ||
                  bleStatus === 'reconnecting' ||
                  liveBpm !== null ||
                  liveSpo2 !== null ||
                  bufferedCount > 0) && (
                  <div className="clinical-card border border-[var(--status-stable)] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Bluetooth className="h-4 w-4 text-[var(--status-stable)]" aria-hidden="true" />
                        <span className="text-sm font-bold text-[var(--text-primary)]">
                          {watchName ?? 'Bluetooth Watch'}
                          {batteryPct !== null ? ` · ${batteryPct}%` : ''}
                        </span>
                        <span className="rounded-full bg-[var(--status-stable-bg)] px-2.5 py-0.5 text-[11px] font-semibold text-[var(--status-stable)]">
                          {bleStatus === 'reconnecting' ? 'Reconnecting…' : 'Live Connected'}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {bufferedCount > 0 && (
                          <button
                            type="button"
                            onClick={() => void flushBleSamples(false)}
                            disabled={syncingBle}
                            className="min-h-8 rounded-full bg-[var(--brand-primary)] px-3 py-1 text-xs font-semibold text-[var(--brand-primary-fg)] disabled:opacity-50 cursor-pointer"
                          >
                            {syncingBle ? 'Syncing…' : `Sync ${bufferedCount} Now`}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={disconnectBleWatch}
                          className="min-h-8 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-4 text-xs text-[var(--text-muted)]">
                      <span>
                        Live HR:{' '}
                        <strong className="font-[family-name:var(--font-mono)] text-[var(--text-primary)]">
                          {liveBpm !== null ? `${liveBpm} bpm` : '—'}
                        </strong>
                      </span>
                      {liveSpo2 !== null && (
                        <span>
                          SpO₂:{' '}
                          <strong className="font-[family-name:var(--font-mono)] text-[var(--text-primary)]">
                            {liveSpo2}%
                          </strong>
                        </span>
                      )}
                      {liveHrv !== null && (
                        <span>
                          HRV:{' '}
                          <strong className="font-[family-name:var(--font-mono)] text-[var(--text-primary)]">
                            {liveHrv} ms
                          </strong>
                        </span>
                      )}
                      <span>
                        Saved to Overview:{' '}
                        <strong className="font-[family-name:var(--font-mono)] text-[var(--text-primary)]">
                          {autoSavedCount}
                        </strong>
                      </span>
                    </div>
                  </div>
                )}

                <div className="clinical-card p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                        {chartWindow === '24h' ? '24-Hour' : chartWindow === '30d' ? '30-Day' : '7-Day'}{' '}
                        Trend vs Personal Normal
                      </p>
                      <h3 className="font-[family-name:var(--font-display)] text-lg font-bold">
                        {activeChartMeta.label} ({activeChartMeta.unit})
                      </h3>
                    </div>
                    <div
                      role="group"
                      aria-label="Chart time window"
                      className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-0.5"
                    >
                      {(['24h', '7d', '30d'] as const).map((win) => (
                        <button
                          key={win}
                          type="button"
                          onClick={() => {
                            setAutoWidened(true);
                            setChartWindow(win);
                          }}
                          className={`min-h-8 rounded-md px-2.5 text-xs font-semibold cursor-pointer ${
                            chartWindow === win
                              ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]'
                              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                          }`}
                        >
                          {win}
                        </button>
                      ))}
                    </div>
                  </div>
                  <VitalsChart
                    compact
                    title={activeChartMeta.label}
                    unit={activeChartMeta.unit}
                    points={selectedChartQuery.data?.points ?? []}
                    bandLow={selectedChartQuery.data?.baseline?.bandLow}
                    bandHigh={selectedChartQuery.data?.baseline?.bandHigh}
                    medianVal={selectedChartQuery.data?.baseline?.medianVal}
                    changePoints={selectedChartQuery.data?.changePoints ?? []}
                    alertTimestamps={(selectedChartQuery.data?.alertMarkers ?? []).map(
                      (a) => a.timestamp,
                    )}
                    loading={selectedChartQuery.isLoading}
                    error={selectedChartQuery.isError ? 'Unable to load physiological trend.' : null}
                    onRetry={() => selectedChartQuery.refetch()}
                    baselineStage={selectedChartQuery.data?.baseline?.stage}
                    validDays={selectedChartQuery.data?.baseline?.validDays}
                    isSynthetic={query.data?.isSynthetic}
                    emptyHint={
                      chartMetric === 'resting_heart_rate' &&
                      ((stepsQuery.data?.points.length ?? 0) > 0 ||
                        (sleepDurQuery.data?.points.length ?? 0) > 0)
                        ? 'Steps/Sleep data is synced, but Google Fit returned 0 Heart Rate samples for this period. Check Heart Rate sharing in Google Fit / Health Connect, or connect Android Health Connect Direct Bridge on Data Import.'
                        : undefined
                    }
                  />
                </div>

                {/* Heart Rate & SpO2 Snapshot Cards */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <article className="clinical-card p-5">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      <Activity className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
                      <span>Resting Heart Rate</span>
                    </div>
                    <p className="mt-2 font-[family-name:var(--font-mono)] text-3xl font-bold tabular-nums">
                      {liveBpm !== null
                        ? `${liveBpm} bpm`
                        : latestRhr
                          ? `${latestRhr.value} bpm`
                          : '—'}
                    </p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      {liveBpm !== null
                        ? `Live from ${watchName ?? 'Bluetooth Watch'}`
                        : rhrQuery.data?.baseline?.bandLow != null &&
                            rhrQuery.data?.baseline?.bandHigh != null
                          ? `Your normal: ${rhrQuery.data.baseline.bandLow}–${rhrQuery.data.baseline.bandHigh} bpm`
                          : 'Personal baseline learning'}
                    </p>
                  </article>

                  <article className="clinical-card p-5">
                    <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      <Wind className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
                      <span>SpO₂ Oxygen Level</span>
                    </div>
                    <p className="mt-2 font-[family-name:var(--font-mono)] text-3xl font-bold tabular-nums">
                      {liveSpo2 !== null
                        ? `${liveSpo2}%`
                        : latestSpo2
                          ? `${latestSpo2.value}%`
                          : '—'}
                    </p>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      {liveSpo2 !== null
                        ? `Live from ${watchName ?? 'Bluetooth Watch'}`
                        : spo2Query.data?.baseline?.bandLow != null &&
                            spo2Query.data?.baseline?.bandHigh != null
                          ? `Your normal: ${spo2Query.data.baseline.bandLow}–${spo2Query.data.baseline.bandHigh}%`
                          : 'Personal baseline learning'}
                    </p>
                  </article>
                </div>

                {/* Recent Alerts Summary */}
                <article className="clinical-card p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <BellRing className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                      <h3 className="font-[family-name:var(--font-display)] text-lg font-bold">
                        Recent Alerts
                      </h3>
                    </div>
                    <Link
                      href="/alerts"
                      className="text-sm font-semibold text-[var(--brand-accent-text)] hover:underline"
                    >
                      View all →
                    </Link>
                  </div>
                  {recentAlerts.length === 0 ? (
                    <p className="mt-3 text-base text-[var(--text-muted)]">
                      No recent alerts recorded. You and your care circle will be notified here if a
                      sustained change appears.
                    </p>
                  ) : (
                    <ul className="mt-3 space-y-2.5 text-base">
                      {recentAlerts.map((al) => (
                        <li
                          key={al.id}
                          className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <StatusBadge level={al.level} />
                            <span className="font-[family-name:var(--font-mono)] text-xs text-[var(--text-muted)]">
                              {new Date(al.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="mt-1.5 text-base font-medium">{al.summaryEn}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              </section>

              {/* Column 3: Care Circle Contact, Daily Check-In, Voice & Medications */}
              <section
                aria-label="Caregiver contact, daily check-in, and medications"
                className="mint-bento space-y-5 p-4 sm:p-5 xl:col-span-3"
              >
                <h2 className="px-1 font-[family-name:var(--font-display)] text-lg font-bold">
                  Care &amp; Support
                </h2>

                {checkinMsg && (
                  <div
                    role="status"
                    className="rounded-2xl border border-[var(--status-stable)] bg-[var(--status-stable-bg)] p-4 text-base font-semibold text-[var(--status-stable)]"
                  >
                    {checkinMsg}
                  </div>
                )}

                {/* Quick Daily Check-in */}
                <div className="clinical-card p-5">
                  <div className="flex items-center gap-2">
                    <HeartPulse className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                    <h3 className="font-[family-name:var(--font-display)] text-lg font-bold">
                      Quick Daily Check-In
                    </h3>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <button
                      type="button"
                      onClick={() => checkinMutation.mutate({ kind: 'tap_ok' })}
                      disabled={checkinMutation.isPending}
                      className="min-h-14 rounded-2xl bg-[var(--status-stable)] px-5 py-3 text-lg font-bold text-white transition hover:opacity-95 cursor-pointer"
                    >
                      {copy.feelOkay}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSymptoms((v) => !v)}
                      className="min-h-14 rounded-2xl border-2 border-[var(--status-watch)] bg-[var(--status-watch-bg)] px-5 py-3 text-lg font-bold text-[var(--status-watch)] cursor-pointer"
                    >
                      {copy.notWell}
                    </button>
                  </div>

                  {showSymptoms && (
                    <div className="mt-4 space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
                      <p className="text-base font-semibold">Tap any symptoms and alert caregiver:</p>
                      <div className="flex flex-wrap gap-2">
                        {['Feverish', 'Short of breath', 'Dizzy', 'Very tired', 'Chest tightness'].map(
                          (sym) => {
                            const active = selectedSymptoms.includes(sym);
                            return (
                              <button
                                key={sym}
                                type="button"
                                onClick={() =>
                                  setSelectedSymptoms((prev) =>
                                    prev.includes(sym)
                                      ? prev.filter((s) => s !== sym)
                                      : [...prev, sym],
                                  )
                                }
                                className={`min-h-11 rounded-xl border px-3 text-sm font-semibold cursor-pointer ${active
                                  ? 'border-[var(--status-watch)] bg-[var(--status-watch)] text-white'
                                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                                  }`}
                              >
                                {sym}
                              </button>
                            );
                          },
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          checkinMutation.mutate({
                            kind: 'tap_unwell',
                            symptoms: selectedSymptoms,
                          })
                        }
                        className="min-h-12 w-full rounded-xl bg-[var(--brand-primary)] px-4 text-base font-bold text-[var(--brand-primary-fg)] cursor-pointer"
                      >
                        Send Update to Care Circle
                      </button>
                    </div>
                  )}
                </div>

                {/* One-Tap Caregiver Contact & Emergency Card */}
                <div className="clinical-card space-y-3 p-5">
                  <p className="text-base font-bold text-[var(--text-primary)]">
                    One-Tap Caregiver Contact
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      checkinMutation.mutate({
                        kind: 'tap_unwell',
                        symptoms: ['Caregiver callback requested'],
                      })
                    }
                    disabled={checkinMutation.isPending}
                    className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 text-base font-bold text-[var(--brand-primary-fg)] transition hover:opacity-95 cursor-pointer"
                  >
                    <PhoneCall className="h-5 w-5" aria-hidden="true" />
                    <span>Ping Caregiver Now</span>
                  </button>

                  <div className="rounded-2xl border-2 border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] p-4">
                    <p className="text-base font-bold text-[var(--status-urgent)]">
                      {copy.callEmergency}
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-[var(--text-primary)]">
                      Emergency: {query.data?.emergencyNumber ?? '112'} · Ambulance:{' '}
                      {query.data?.ambulanceNumber ?? '108'}
                    </p>
                    <Link
                      href="/alerts"
                      className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--status-urgent)] px-4 text-base font-bold text-white"
                    >
                      <PhoneCall className="h-4 w-4" aria-hidden="true" />
                      <span>Call Care / 112 Options</span>
                    </Link>
                  </div>
                </div>

                {/* Today's Medication Schedule */}
                {(query.data?.medications ?? []).length > 0 && (
                  <div className="clinical-card p-5">
                    <div className="flex items-center gap-2">
                      <Pill className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
                      <h3 className="font-[family-name:var(--font-display)] text-lg font-bold">
                        Today&apos;s Medication Check
                      </h3>
                    </div>
                    <ul className="mt-3 space-y-3">
                      {(query.data?.medications ?? []).map((med) => (
                        <li
                          key={med.id}
                          className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3.5"
                        >
                          <p className="text-base font-semibold">
                            {med.name} · {med.dosage}
                          </p>
                          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
                            Schedule: {med.scheduleTimes.join(', ')}
                            {med.affectsHeartRate ? ' · Influences heart rate trend' : ''}
                          </p>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                medMutation.mutate({ medicationId: med.id, status: 'taken' })
                              }
                              className="min-h-12 flex-1 rounded-xl bg-[var(--status-stable)] px-3 text-sm font-bold text-white cursor-pointer"
                            >
                              Mark Taken
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                medMutation.mutate({ medicationId: med.id, status: 'missed' })
                              }
                              className="min-h-12 flex-1 rounded-xl border border-[var(--status-watch)] bg-[var(--status-watch-bg)] px-3 text-sm font-bold text-[var(--status-watch)] cursor-pointer"
                            >
                              Missed Dose
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            </div>

            {/* Voice Check-In Companion (Preserves voice red-flag accessibility) */}
            <VoiceCheckinCompanion
              patientId={query.data?.patientId}
              locale={lang}
              isSynthetic={Boolean(query.data?.isSynthetic)}
              onRecorded={() => qc.invalidateQueries({ queryKey: ['dashboard-patient'] })}
            />
          </>
        )}
        </RoleWorkspaceGuard>
      </main>
    </SentinelShell>
  );
}
