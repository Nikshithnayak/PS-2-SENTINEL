'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  HeartPulse,
  HelpCircle,
  Lock,
  PhoneCall,
  Pill,
  Volume2,
} from 'lucide-react';
import { SentinelNav } from '@/components/sentinel-nav';
import { VoiceCheckinCompanion } from '@/components/voice/voice-checkin';

interface PatientDashboardData {
  patientId: string;
  patientFirstName: string;
  locale: 'en' | 'kn' | 'hi';
  emergencyNumber: string;
  ambulanceNumber: string;
  isSynthetic: boolean;
  silence: {
    hoursSilent: number | null;
    isSilent: boolean;
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

export default function PatientTodayPage() {
  const qc = useQueryClient();
  const [lang, setLang] = useState<'en' | 'kn' | 'hi'>('en');
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
          : 'Saved: Care circle alerted that you are not feeling well.',
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
      boxClass: 'border-[var(--status-watch)] bg-[var(--status-watch-bg)]',
      textClass: 'text-[var(--status-watch)]',
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
    'No wearable summary calculated yet. Upload watch data or check back once telemetry arrives.';

  function readAloud() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(`${statusMeta.title}. ${summarySentence}`);
    utter.lang = lang === 'kn' ? 'kn-IN' : lang === 'hi' ? 'hi-IN' : 'en-IN';
    utter.rate = 0.9;
    window.speechSynthesis.speak(utter);
  }

  return (
    <div className="min-h-dvh bg-[var(--bg-base)] text-[var(--text-primary)] text-[18px]">
      <SentinelNav
        title="Patient Today (Elder Mode)"
        isSynthetic={query.data?.isSynthetic}
        rightSlot={
          <div className="flex items-center gap-1" role="group" aria-label="Language selector">
            {(['en', 'kn', 'hi'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className={`min-h-11 rounded-lg border px-3 text-sm font-bold cursor-pointer ${
                  lang === code
                    ? 'border-[var(--brand-primary)] bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]'
                    : 'border-[var(--border-subtle)]'
                }`}
              >
                {code === 'en' ? 'EN' : code === 'kn' ? 'ಕನ್ನಡ' : 'हिन्दी'}
              </button>
            ))}
          </div>
        }
      />

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        {isUnauth ? (
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-8 text-center">
            <Lock className="mx-auto h-10 w-10 text-[var(--brand-primary)]" aria-hidden="true" />
            <h2 className="mt-3 text-2xl font-semibold">Sign in for Patient Today view</h2>
            <Link
              href="/auth"
              className="mt-5 inline-flex min-h-14 items-center rounded-xl bg-[var(--brand-primary)] px-6 text-lg font-semibold text-[var(--brand-primary-fg)]"
            >
              Sign In
            </Link>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xl font-semibold">
                {copy.greeting}, {query.data?.patientFirstName ?? 'Friend'}
              </p>
              <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-1.5 text-sm font-medium">
                {query.data?.baselines[0]
                  ? `Baseline: ${query.data.baselines[0].status} (${query.data.baselines[0].validDays} days)`
                  : 'Baseline: Learning'}
              </span>
            </div>

            {checkinMsg && (
              <div
                role="status"
                className="rounded-2xl border border-[var(--status-stable)] bg-[var(--status-stable-bg)] p-4 text-lg font-medium text-[var(--status-stable)]"
              >
                {checkinMsg}
              </div>
            )}

            {/* Primary Elder Calm Status Card */}
            <section
              aria-label="Today's personal health status"
              className={`rounded-3xl border-2 p-6 sm:p-8 ${statusMeta.boxClass}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <StatusIcon className={`h-9 w-9 shrink-0 ${statusMeta.textClass}`} aria-hidden="true" />
                  <h2 className={`font-[family-name:var(--font-display)] text-2xl font-bold sm:text-3xl ${statusMeta.textClass}`}>
                    {statusMeta.title}
                  </h2>
                </div>
                <span className="rounded-full bg-[var(--bg-surface)] px-4 py-1.5 font-[family-name:var(--font-mono)] text-base font-bold uppercase">
                  {level}
                </span>
              </div>

              <p className="mt-4 text-xl leading-relaxed text-[var(--text-primary)]">
                {summarySentence}
              </p>

              <p className="mt-2 text-sm text-[var(--text-muted)]">
                Early awareness only — changes from your personal normal, not a medical diagnosis.
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={readAloud}
                  className="inline-flex min-h-14 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 text-lg font-semibold hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  <Volume2 className="h-5 w-5" aria-hidden="true" />
                  <span>{copy.readAloud}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowWhy((v) => !v)}
                  aria-expanded={showWhy}
                  className="inline-flex min-h-14 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 text-lg font-semibold hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  <HelpCircle className="h-5 w-5" aria-hidden="true" />
                  <span>{copy.whyBtn}</span>
                </button>
              </div>

              {showWhy && (
                <div
                  data-testid="why-drawer"
                  className="mt-5 space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
                >
                  <h3 className="text-lg font-semibold">What changed from your personal normal:</h3>
                  {(query.data?.latestAssessment?.contributions ?? []).length === 0 ? (
                    <p className="text-base text-[var(--text-muted)]">
                      Run a baseline check on Data & Import or wear your watch to populate signal bars.
                    </p>
                  ) : (
                    <ul className="space-y-2.5 text-base">
                      {(query.data?.latestAssessment?.contributions ?? []).slice(0, 4).map((c) => (
                        <li
                          key={c.metricType}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-subtle)] p-3"
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

            {/* Quick Check-in Big Elder Buttons (>= 56px height, >= 12px gap) */}
            <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
              <div className="flex items-center gap-2">
                <HeartPulse className="h-6 w-6 text-[var(--brand-primary)]" aria-hidden="true" />
                <h2 className="text-xl font-semibold">Quick Daily Check-In</h2>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => checkinMutation.mutate({ kind: 'tap_ok' })}
                  disabled={checkinMutation.isPending}
                  className="min-h-14 rounded-2xl bg-[var(--status-stable)] px-6 py-4 text-xl font-bold text-white cursor-pointer"
                >
                  {copy.feelOkay}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSymptoms((v) => !v)}
                  className="min-h-14 rounded-2xl border-2 border-[var(--status-watch)] bg-[var(--status-watch-bg)] px-6 py-4 text-xl font-bold text-[var(--status-watch)] cursor-pointer"
                >
                  {copy.notWell}
                </button>
              </div>

              {showSymptoms && (
                <div className="mt-4 space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4">
                  <p className="text-base font-semibold">Tap any symptoms and send to caregiver:</p>
                  <div className="flex flex-wrap gap-3">
                    {['Feverish', 'Short of breath', 'Dizzy', 'Very tired', 'Chest tightness'].map((sym) => {
                      const active = selectedSymptoms.includes(sym);
                      return (
                        <button
                          key={sym}
                          type="button"
                          onClick={() =>
                            setSelectedSymptoms((prev) =>
                              prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym],
                            )
                          }
                          className={`min-h-12 rounded-xl border px-4 text-base font-semibold cursor-pointer ${
                            active
                              ? 'border-[var(--status-watch)] bg-[var(--status-watch)] text-white'
                              : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                          }`}
                        >
                          {sym}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      checkinMutation.mutate({ kind: 'tap_unwell', symptoms: selectedSymptoms })
                    }
                    className="min-h-14 w-full rounded-xl bg-[var(--brand-primary)] px-5 text-lg font-bold text-[var(--brand-primary-fg)] cursor-pointer"
                  >
                    Send Update to Care Circle
                  </button>
                </div>
              )}
            </section>

            {/* Voice Check-In Companion */}
            <VoiceCheckinCompanion
              patientId={query.data?.patientId}
              locale={lang}
              isSynthetic={Boolean(query.data?.isSynthetic)}
              onRecorded={() => qc.invalidateQueries({ queryKey: ['dashboard-patient'] })}
            />

            {/* Daily Medication Schedule & Adherence Overlay */}
            {(query.data?.medications ?? []).length > 0 && (
              <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
                <div className="flex items-center gap-2">
                  <Pill className="h-6 w-6 text-[var(--brand-primary)]" aria-hidden="true" />
                  <h2 className="text-xl font-semibold">Today&apos;s Medication Check</h2>
                </div>
                <ul className="mt-4 space-y-3">
                  {(query.data?.medications ?? []).map((med) => (
                    <li
                      key={med.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4"
                    >
                      <div>
                        <p className="text-lg font-semibold">
                          {med.name} · {med.dosage}
                        </p>
                        <p className="text-sm text-[var(--text-muted)]">
                          Schedule: {med.scheduleTimes.join(', ')}
                          {med.affectsHeartRate ? ' · Influences heart rate trend' : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => medMutation.mutate({ medicationId: med.id, status: 'taken' })}
                          className="min-h-12 rounded-xl bg-[var(--status-stable)] px-4 text-base font-bold text-white cursor-pointer"
                        >
                          Mark Taken
                        </button>
                        <button
                          type="button"
                          onClick={() => medMutation.mutate({ medicationId: med.id, status: 'missed' })}
                          className="min-h-12 rounded-xl border border-[var(--status-watch)] px-4 text-base font-bold text-[var(--status-watch)] cursor-pointer"
                        >
                          Missed Dose
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Unmistakable Emergency Card */}
            <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border-2 border-[var(--status-urgent)] bg-[var(--bg-surface)] p-5">
              <div>
                <p className="text-lg font-bold text-[var(--status-urgent)]">{copy.callEmergency}</p>
                <p className="text-sm text-[var(--text-muted)]">
                  Emergency: {query.data?.emergencyNumber ?? '112'} · Ambulance:{' '}
                  {query.data?.ambulanceNumber ?? '108'}
                </p>
              </div>
              <Link
                href="/alerts"
                className="inline-flex min-h-14 items-center gap-2 rounded-xl bg-[var(--status-urgent)] px-5 text-lg font-bold text-white"
              >
                <PhoneCall className="h-5 w-5" aria-hidden="true" />
                <span>Call Care / 112 Options</span>
              </Link>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
