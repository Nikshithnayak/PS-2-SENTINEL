'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, AlertCircle, CheckCircle2, Lock, UserPlus } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { ThemeToggle } from '@/components/theme-toggle';

const DEMO_ACCOUNTS = [
  { label: 'Ramesh Pai (Patient · Elder)', email: 'ramesh@sentinel.local', role: 'patient' },
  { label: 'Kavitha Pai (Primary Caregiver)', email: 'kavitha@sentinel.local', role: 'caregiver' },
  { label: 'Dr. Arvind Shetty (Clinician)', email: 'dr.shetty@sentinel.local', role: 'clinician' },
  { label: 'Nitte Pharma R&D (Org Admin)', email: 'research@sentinel.local', role: 'org_admin' },
] as const;

export default function AuthPage() {
  const router = useRouter();
  const { data: session, refetch } = authClient.useSession();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('ramesh@sentinel.local');
  const [password, setPassword] = useState('SentinelDemo#2026');
  const [role, setRole] = useState<'patient' | 'caregiver' | 'clinician' | 'org_admin'>('patient');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'signin') {
        const res = await authClient.signIn.email({ email, password });
        if (res.error) {
          setError(res.error.message ?? 'Sign in failed');
          return;
        }
      } else {
        const res = await authClient.signUp.email({
          email,
          password,
          name: name || email.split('@')[0] || 'User',
          role,
          locale: 'en',
        } as Parameters<typeof authClient.signUp.email>[0]);
        if (res.error) {
          setError(res.error.message ?? 'Account creation failed');
          return;
        }
      }
      await refetch();
      router.push('/settings/consent');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    await authClient.signOut();
    await refetch();
    router.refresh();
  }

  return (
    <div className="min-h-dvh bg-[var(--bg-base)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[var(--text-primary)] hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Back to Home</span>
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-10">
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-6 sm:p-8">
          <div className="flex items-center justify-between">
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold">
              {mode === 'signin' ? 'Sign in to Sachet · SENTINEL' : 'Create SENTINEL account'}
            </h1>
            <button
              type="button"
              onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
              className="min-h-11 rounded-lg px-3 text-sm font-semibold text-[var(--brand-accent-text)] hover:bg-[var(--bg-elevated)] cursor-pointer"
            >
              {mode === 'signin' ? 'Create account' : 'Have an account? Sign in'}
            </button>
          </div>

          {session?.user && (
            <div className="mt-4 flex items-center justify-between rounded-xl border border-[var(--status-stable)] bg-[var(--status-stable-bg)] p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--status-stable)]">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  Signed in as <strong>{session.user.name}</strong> ({session.user.email})
                </span>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm font-medium text-[var(--text-primary)] cursor-pointer"
              >
                Sign out
              </button>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] p-3 text-sm font-medium text-[var(--status-urgent)]"
            >
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === 'signup' && (
              <>
                <div>
                  <label htmlFor="auth-name" className="block text-sm font-semibold">
                    Full Name
                  </label>
                  <input
                    id="auth-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Ramesh Pai"
                    className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-base"
                  />
                </div>
                <div>
                  <label htmlFor="auth-role" className="block text-sm font-semibold">
                    Role
                  </label>
                  <select
                    id="auth-role"
                    value={role}
                    onChange={(e) =>
                      setRole(e.target.value as 'patient' | 'caregiver' | 'clinician' | 'org_admin')
                    }
                    className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-base"
                  >
                    <option value="patient">Patient (Elder Mode)</option>
                    <option value="caregiver">Caregiver (Care Circle)</option>
                    <option value="clinician">Clinician</option>
                    <option value="org_admin">Org Admin / Researcher</option>
                  </select>
                </div>
              </>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-sm font-semibold">
                Email Address
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-base"
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="block text-sm font-semibold">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 text-base"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand-primary)] px-4 text-base font-semibold text-[var(--brand-primary-fg)] transition hover:opacity-95 disabled:opacity-60 cursor-pointer"
            >
              {mode === 'signin' ? (
                <>
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  <span>{loading ? 'Signing in...' : 'Sign In'}</span>
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  <span>{loading ? 'Creating account...' : 'Create Account'}</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-8 border-t border-[var(--border-subtle)] pt-6">
            <h2 className="text-sm font-semibold text-[var(--text-muted)]">
              Seeded Local Demo Accounts (Password: SentinelDemo#2026)
            </h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {DEMO_ACCOUNTS.map((acct) => (
                <button
                  key={acct.email}
                  type="button"
                  onClick={() => {
                    setMode('signin');
                    setEmail(acct.email);
                    setPassword('SentinelDemo#2026');
                  }}
                  className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2 text-left text-xs font-medium hover:border-[var(--brand-primary)] cursor-pointer"
                >
                  <div className="font-semibold text-[var(--text-primary)]">{acct.label}</div>
                  <div className="font-[family-name:var(--font-mono)] text-[var(--text-muted)]">
                    {acct.email}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
