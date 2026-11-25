import Link from 'next/link';
import { BookOpen, ShieldAlert, Stethoscope } from 'lucide-react';
import { SentinelNav } from '@/components/sentinel-nav';

export default function ModelCardPage() {
  return (
    <div className="min-h-dvh bg-[var(--bg-base)] text-[var(--text-primary)]">
      <SentinelNav title="Model Card & Safety Disclosures" />

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6">
        <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-[var(--brand-primary)]" aria-hidden="true" />
            <h2 className="text-xl font-semibold">
              Sachet · SENTINEL Statistical Engine (<code>sentinel-det-v1.0.0</code>)
            </h2>
          </div>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            A deterministic, explainable 3-layer physiological deterioration awareness model designed
            for home elder monitoring and chronic-care triage support.
          </p>
        </section>

        <section className="space-y-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 text-sm">
          <div>
            <h3 className="text-base font-semibold">1. Intended Use & Clinical Boundaries</h3>
            <p className="mt-1 text-[var(--text-muted)]">
              Intended strictly as an early-awareness screening companion highlighting deviations from
              a person&apos;s own normal (&ldquo;changes from your personal normal&rdquo;). SENTINEL
              is NOT a medical device and NEVER issues diagnostic claims. Urgent alerts display
              configured emergency services (112 / 108 India default).
            </p>
          </div>

          <div>
            <h3 className="text-base font-semibold">2. Personal Baseline & Architecture</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[var(--text-muted)]">
              <li>
                <strong>Baseline Calibration:</strong> Weighted median + <code>1.4826 × MAD</code>{' '}
                scale per metric/circadian block with 14-day empirical Bayes shrinkage (<code>k=5</code>{' '}
                days) toward age/sex and condition priors (
                <code>warming_prior -&gt; learning -&gt; calibrated</code>) and quarantine against{' '}
                <code>excluded_periods</code> and 48h tail acute windows.
              </li>
              <li>
                <strong>L1 Safety Bounds:</strong> Cited critical thresholds (NEWS2-aligned + COPD
                Scale 2 88–92% SpO2 mode), exercise-guarded against active step bursts.
              </li>
              <li>
                <strong>L2 Personal Temporal Detectors:</strong> Directional z-score, EWMA drift,
                Page-Hinkley/CUSUM accumulator, and <code>ruptures.Pelt</code> change-point
                localization.
              </li>
              <li>
                <strong>L3 Multivariate Coherence:</strong> Robust covariance (<code>MinCovDet</code> /{' '}
                <code>LedoitWolf</code>) Mahalanobis distance, streaming{' '}
                <code>river.anomaly.HalfSpaceTrees</code>, and <code>IsolationForest</code>. Neural
                autoencoder ships disabled behind <code>ENABLE_AUTOENCODER_L3=false</code>.
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-base font-semibold">3. Known Failure Modes & Equity Considerations</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[var(--text-muted)]">
              <li>
                <strong>Optical PPG Skin-Tone & Perfusion Bias:</strong> Darker skin melanin
                pigmentation and cold peripheral vasoconstriction can elevate green/red optical SpO2 and
                HR variance. Low-confidence readings are weighted accordingly and should be cross-checked
                with finger-clip pulse oximetry.
              </li>
              <li>
                <strong>Motion Artifacts:</strong> Optical HR/SpO2 drops during high step cadence are
                flagged <code>motion_artifact</code> with reduced confidence (&lt; 0.50).
              </li>
              <li>
                <strong>Partial NEWS2 Limits:</strong> Wearables cannot measure ACVPU consciousness,
                supplemental O2 usage, or passive cuff BP; SENTINEL marks these fields explicitly{' '}
                <code>unavailable_from_wearable</code>.
              </li>
            </ul>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              href="/eval"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 text-xs font-semibold text-[var(--brand-primary-fg)]"
            >
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              Open Evaluation Lab
            </Link>
            <Link
              href="/clinician"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border-subtle)] px-4 text-xs font-semibold"
            >
              <Stethoscope className="h-4 w-4" aria-hidden="true" />
              Clinician View
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
