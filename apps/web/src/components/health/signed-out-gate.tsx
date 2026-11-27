'use client';

import Link from 'next/link';
import { Lock, ShieldCheck } from 'lucide-react';

export function SignedOutGate({
  heading,
  description = 'Protected personal health summaries and care-circle workflows are isolated until you sign in.',
  signInHref = '/auth',
  signInLabel = 'Sign In to Continue',
}: {
  heading: string;
  description?: string;
  signInHref?: string;
  signInLabel?: string;
}) {
  const altHref = signInHref === '/auth' ? '/caregiver/login' : '/auth';
  const altLabel = signInHref === '/auth' ? 'Caregiver / Clinician Login' : 'Patient Portal';

  return (
    <div className="clinical-card mx-auto max-w-xl p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--bg-mint-panel)] text-[var(--brand-primary)]">
        <Lock className="h-6 w-6" aria-hidden="true" />
      </div>
      <h2 className="mt-4 font-[family-name:var(--font-display)] text-2xl font-bold">{heading}</h2>
      <p className="mt-2 text-sm text-[var(--text-muted)]">{description}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href={signInHref}
          className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--brand-primary)] px-6 text-base font-semibold text-[var(--brand-primary-fg)] transition hover:opacity-95"
        >
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          <span>{signInLabel}</span>
        </Link>
        <Link
          href={altHref}
          className="inline-flex min-h-12 items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-5 text-sm font-semibold hover:bg-[var(--bg-elevated)]"
        >
          {altLabel}
        </Link>
      </div>
    </div>
  );
}
