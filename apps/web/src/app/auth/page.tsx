'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  HeartHandshake,
  Info,
  Lock,
  ShieldCheck,
  Stethoscope,
  UserPlus,
  Users,
} from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { ThemeToggle } from '@/components/theme-toggle';

interface AuthProvidersState {
  google: {
    enabled: boolean;
    callbackUrl: string;
    hostedDomain: string | null;
    missingEnvVars: string[];
  };
}

const ROLE_TABS = [
  {
    id: 'patient' as const,
    label: 'Patient',
    icon: HeartHandshake,
    hint: 'Calm Elder Mode (/today) in English, Kannada, or Hindi',
  },
  {
    id: 'caregiver' as const,
    label: 'Caregiver',
    icon: Users,
    hint: 'Care Circle console with real-time alerts and escalation',
  },
  {
    id: 'clinician' as const,
    label: 'Clinician',
    icon: Stethoscope,
    hint: 'Consented cohort triage, personal baseline bands & FHIR reports',
  },
] as const;

export default function AuthPage() {
  const router = useRouter();
  const { data: session, refetch } = authClient.useSession();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'patient' | 'caregiver' | 'clinician' | 'org_admin'>('patient');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showGoogleSetup, setShowGoogleSetup] = useState(false);
  const [providersStatus, setProvidersStatus] = useState<AuthProvidersState | null>(null);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const oauthErr = params.get('oauthError') ?? params.get('error');
    if (oauthErr) {
      setError(`Google sign-in returned an error: ${oauthErr}.`);
    }

    fetch('/api/v1/auth/providers')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: AuthProvidersState | null) => {
        if (active && data) setProvidersStatus(data);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  async function handleGoogleSignIn() {
    setError(null);
    if (!providersStatus?.google.enabled) {
      setShowGoogleSetup((prev) => !prev);
      return;
    }

    setGoogleLoading(true);
    try {
      const targetHref =
        role === 'caregiver' ? '/caregiver' : role === 'clinician' || role === 'org_admin' ? '/clinician' : '/today';
      const res = await authClient.signIn.social({
        provider: 'google',
        callbackURL: targetHref,
        errorCallbackURL: '/auth?oauthError=google_signin_failed',
      });
      if (res?.error) {
        setError(res.error.message ?? 'Google sign-in failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      setGoogleLoading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'signin') {
        const res = await authClient.signIn.email({ email, password });
        if (res.error) {
          setError(res.error.message ?? 'Sign in failed. Verify your email and password.');
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
          setError(res.error.message ?? 'Account creation failed.');
          return;
        }
      }
      await refetch();
      const updated = await authClient.getSession();
      const resolvedRole =
        ((updated.data?.user as { role?: string } | undefined)?.role ?? role) as string;
      const dest =
        resolvedRole === 'caregiver'
          ? '/caregiver'
          : resolvedRole === 'clinician' || resolvedRole === 'org_admin'
            ? '/clinician'
            : '/today';
      router.push(dest);
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

  const activeRoleTab = ROLE_TABS.find((t) => t.id === role) ?? ROLE_TABS[0];

  return (
    <div className="min-h-dvh bg-[var(--bg-base)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border-subtle)] px-3 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Back to Home</span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full bg-[var(--bg-mint-panel)] px-3 py-1 text-xs font-semibold text-[var(--brand-accent-text)] sm:inline-flex">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Pre-Login PHI Isolation
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
        <div className="mint-bento p-4 sm:p-6">
          <div className="clinical-card p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]">
                  <Activity className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold">
                    {mode === 'signin' ? 'Sign in to Sachet · SENTINEL' : 'Create SENTINEL account'}
                  </h1>
                  <p className="text-xs text-[var(--text-muted)]">
                    Protected by PostgreSQL Row-Level Security &amp; field encryption
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
                className="min-h-11 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 text-sm font-semibold text-[var(--brand-accent-text)] hover:bg-[var(--bg-mint-panel)] cursor-pointer"
              >
                {mode === 'signin' ? 'Create account' : 'Have an account? Sign in'}
              </button>
            </div>

            {session?.user && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--status-stable)] bg-[var(--status-stable-bg)] p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-[var(--status-stable)]">
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    Signed in as <strong>{session.user.name}</strong> ({session.user.email})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="min-h-11 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-sm font-semibold text-[var(--text-primary)] cursor-pointer"
                >
                  Sign out
                </button>
              </div>
            )}

            {/* Clear Role Access Selector */}
            <div className="mt-6">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                Select Workspace Role
              </p>
              <div role="tablist" aria-label="Portal roles" className="mt-2 grid grid-cols-3 gap-2">
                {ROLE_TABS.map((tab) => {
                  const Icon = tab.icon;
                  const selected = role === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setRole(tab.id)}
                      className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-xs font-semibold transition cursor-pointer ${
                        selected
                          ? 'border-[var(--brand-rail-active)] bg-[var(--brand-rail-active)] text-[var(--brand-rail-active-fg)]'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                      }`}
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-[var(--text-muted)]">{activeRoleTab.hint}</p>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] p-3 text-sm font-medium text-[var(--status-urgent)]"
              >
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-5 space-y-3">
              <button
                type="button"
                disabled={googleLoading || loading}
                onClick={handleGoogleSignIn}
                data-testid="google-signin-button"
                className="inline-flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 text-base font-semibold text-[var(--text-primary)] transition hover:border-[var(--brand-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-60 cursor-pointer"
              >
                <span className="inline-flex items-center gap-3">
                  <svg className="h-5 w-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.54-5.17 3.54-8.87Z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.94-2.91l-3.88-3c-1.08.72-2.46 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.96H1.27v3.09A12 12 0 0 0 12 24Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.28A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.28V6.63H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.37l4.01-3.09Z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.76c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.63l4.01 3.09c.95-2.85 3.6-4.96 6.72-4.96Z"
                    />
                  </svg>
                  <span>{googleLoading ? 'Redirecting to Google...' : 'Continue with Google'}</span>
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    providersStatus?.google.enabled
                      ? 'bg-[var(--status-stable-bg)] text-[var(--status-stable)]'
                      : 'bg-[var(--status-watch-bg)] text-[var(--status-watch)]'
                  }`}
                >
                  {providersStatus?.google.enabled ? 'OAuth Ready' : 'Needs Keys'}
                </span>
              </button>

              {showGoogleSetup && providersStatus && !providersStatus.google.enabled && (
                <div
                  role="status"
                  data-testid="google-setup-notice"
                  className="rounded-xl border border-[var(--status-watch)] bg-[var(--status-watch-bg)] p-4 text-xs text-[var(--text-primary)]"
                >
                  <div className="flex items-start gap-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--status-watch)]" aria-hidden="true" />
                    <div className="space-y-1.5">
                      <p className="font-semibold">
                        Google Sign-In requires Google Cloud OAuth 2.0 credentials
                      </p>
                      <p>
                        Set{' '}
                        <code className="font-[family-name:var(--font-mono)]">
                          {providersStatus.google.missingEnvVars.join(' & ')}
                        </code>{' '}
                        in <code className="font-[family-name:var(--font-mono)]">.env</code> (see{' '}
                        <code className="font-[family-name:var(--font-mono)]">docs/SETUP-NEEDED.md</code>
                        ) and restart the server.
                      </p>
                      <p>
                        Authorized Redirect URI:{' '}
                        <code className="font-[family-name:var(--font-mono)] break-all">
                          {providersStatus.google.callbackUrl}
                        </code>
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="relative flex items-center py-1">
                <div className="grow border-t border-[var(--border-subtle)]" />
                <span className="mx-3 text-xs font-medium text-[var(--text-muted)]">
                  or continue with email
                </span>
                <div className="grow border-t border-[var(--border-subtle)]" />
              </div>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
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
                      placeholder="Your full name"
                      className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3.5 text-base"
                    />
                  </div>
                  <div>
                    <label htmlFor="auth-role" className="block text-sm font-semibold">
                      Account Role
                    </label>
                    <select
                      id="auth-role"
                      value={role}
                      onChange={(e) =>
                        setRole(e.target.value as 'patient' | 'caregiver' | 'clinician' | 'org_admin')
                      }
                      className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3.5 text-base"
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
                  className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3.5 text-base"
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
                  className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3.5 text-base"
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
          </div>
        </div>
      </main>
    </div>
  );
}
