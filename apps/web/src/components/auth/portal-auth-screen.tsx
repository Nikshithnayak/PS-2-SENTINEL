'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertCircle,
  Building2,
  CheckCircle2,
  HeartHandshake,
  Info,
  Lock,
  LogOut,
  ShieldCheck,
  Stethoscope,
  UserPlus,
  Users,
} from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { getPortalConfig, portalForRole, type PortalKind } from '@/lib/auth-portal';

interface AuthProvidersState {
  google: {
    enabled: boolean;
    callbackUrl: string;
    hostedDomain: string | null;
    missingEnvVars: string[];
  };
}

const PORTAL_META: Record<
  PortalKind,
  {
    headerTitle: string;
    badgeLabel: string;
    headingSignIn: string;
    headingSignUp: string;
    subtitle: string;
    roleNotice: string;
    headerClass: string;
    accentBadgeClass: string;
    icon: typeof Activity;
  }
> = {
  patient: {
    headerTitle: 'Patient · Elder Portal',
    badgeLabel: 'Personal Health & Daily Mode',
    headingSignIn: 'Sign in to Sachet · SENTINEL',
    headingSignUp: 'Create SENTINEL account',
    subtitle: 'Personal physiological baselines, Elder Mode /today, and smartwatch sync',
    roleNotice:
      'Elder & personal patient portal. Need to log in as a family Caregiver or Clinician on this device? Open their separate portal below.',
    headerClass: 'border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)]',
    accentBadgeClass: 'bg-[var(--status-stable-bg)] text-[var(--status-stable)]',
    icon: HeartHandshake,
  },
  caregiver: {
    headerTitle: 'Caregiver & Family Monitor',
    badgeLabel: 'Separate Caregiver Portal',
    headingSignIn: 'Caregiver Portal Sign In',
    headingSignUp: 'Register Caregiver Account',
    subtitle: 'Dedicated family & care-circle system for live alerts, SSE status & escalation',
    roleNotice:
      'Separate login for family members and caregivers. Signing in here opens Caregiver Monitor (/caregiver) — never Patient Elder Mode.',
    headerClass: 'border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)]',
    accentBadgeClass: 'bg-[var(--status-watch-bg)] text-[var(--status-watch)]',
    icon: Users,
  },
  clinician: {
    headerTitle: 'Clinician Workstation System',
    badgeLabel: 'Clinical Staff & Cohort Triage',
    headingSignIn: 'Clinician System Sign In',
    headingSignUp: 'Register Clinician Credential',
    subtitle: 'Isolated clinical decision support system · Consented cohort, Partial NEWS2 & FHIR R4',
    roleNotice:
      'Independent clinical staff authentication system. Strictly enforces patient consent grants and never shares a patient workspace.',
    headerClass: 'border-b border-[#0f293a] bg-[#0f293a] text-white',
    accentBadgeClass: 'bg-[#d5efec] text-[#0f293a]',
    icon: Stethoscope,
  },
};

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

export function PortalAuthScreen({ portal }: { portal: PortalKind }) {
  const router = useRouter();
  const { data: session, refetch } = authClient.useSession();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [credentialOrg, setCredentialOrg] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'patient' | 'caregiver' | 'clinician' | 'org_admin'>(
    portal === 'caregiver' ? 'caregiver' : portal === 'clinician' ? 'clinician' : 'patient',
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showGoogleSetup, setShowGoogleSetup] = useState(false);
  const [providersStatus, setProvidersStatus] = useState<AuthProvidersState | null>(null);

  const meta = PORTAL_META[portal];
  const PortalIcon = meta.icon;
  const activeSessionRole = (session?.user as { role?: string } | undefined)?.role;
  const sessionBelongsHere = activeSessionRole
    ? portal === 'clinician'
      ? activeSessionRole === 'clinician' || activeSessionRole === 'org_admin'
      : activeSessionRole === portal
    : false;

  useEffect(() => {
    setRole(
      portal === 'caregiver' ? 'caregiver' : portal === 'clinician' ? 'clinician' : 'patient',
    );
  }, [portal]);

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

  function targetPortalForSelection(): PortalKind {
    if (portal === 'caregiver') return 'caregiver';
    if (portal === 'clinician') return 'clinician';
    return role === 'caregiver' ? 'caregiver' : role === 'clinician' || role === 'org_admin' ? 'clinician' : 'patient';
  }

  async function syncPortalIntentCookie(intended: PortalKind) {
    await fetch('/api/v1/auth/portal-intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: intended }),
    }).catch(() => {});
  }

  async function handleGoogleSignIn() {
    setError(null);
    if (!providersStatus?.google.enabled) {
      setShowGoogleSetup((prev) => !prev);
      return;
    }

    setGoogleLoading(true);
    try {
      const intendedPortal = targetPortalForSelection();
      if (session?.user) {
        await authClient.signOut();
      }
      await syncPortalIntentCookie(intendedPortal);
      const portalCfg = getPortalConfig(intendedPortal);
      const res = await authClient.signIn.social({
        provider: 'google',
        callbackURL: '/auth/oauth-complete',
        errorCallbackURL: `${portalCfg.loginPath}?oauthError=google_signin_failed`,
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
      const selectedRole =
        portal === 'caregiver'
          ? 'caregiver'
          : portal === 'clinician'
            ? role === 'org_admin'
              ? 'org_admin'
              : 'clinician'
            : role;

      // Always clear an existing session from another person/role before switching login
      if (session?.user) {
        await authClient.signOut();
      }

      if (mode === 'signin') {
        const res = await authClient.signIn.email({ email, password });
        if (res.error) {
          setError(res.error.message ?? 'Sign in failed. Verify your email and password.');
          return;
        }
      } else {
        const formattedName =
          portal === 'clinician' && credentialOrg.trim()
            ? `${(name || email.split('@')[0] || 'Clinician').trim()} · ${credentialOrg.trim()}`
            : name || email.split('@')[0] || 'User';

        const res = await authClient.signUp.email({
          email,
          password,
          name: formattedName,
          role: selectedRole,
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
        ((updated.data?.user as { role?: string } | undefined)?.role ?? selectedRole) as string;

      // Strictly prevent dedicated Caregiver or Clinician portals from dropping a user into Patient /today!
      if (portal === 'caregiver' && resolvedRole !== 'caregiver') {
        await authClient.signOut();
        await refetch();
        setError(
          `${email} is registered as "${resolvedRole.replace('_', ' ')}", not a Caregiver account. Switch to "Create Caregiver Account" above to register a separate Caregiver login.`,
        );
        return;
      }

      if (portal === 'clinician' && resolvedRole !== 'clinician' && resolvedRole !== 'org_admin') {
        await authClient.signOut();
        await refetch();
        setError(
          `${email} is registered as "${resolvedRole.replace('_', ' ')}", not a Clinician account. Switch to "Register Clinician Credential" above to create a separate clinician login.`,
        );
        return;
      }

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
      <header className={meta.headerClass}>
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                portal === 'clinician'
                  ? 'bg-white/15 text-white'
                  : 'bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]'
              }`}
            >
              <Activity className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="font-[family-name:var(--font-display)] text-base font-bold leading-tight">
                Sachet · SENTINEL
              </p>
              <p
                className={`text-xs ${
                  portal === 'clinician' ? 'text-white/75' : 'text-[var(--text-muted)]'
                }`}
              >
                {meta.headerTitle}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {portal !== 'patient' && (
              <Link
                href="/auth"
                className={`inline-flex min-h-10 items-center rounded-xl border px-3 text-xs font-semibold ${
                  portal === 'clinician'
                    ? 'border-white/25 text-white hover:bg-white/10'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                }`}
              >
                Patient Portal
              </Link>
            )}
            {portal !== 'caregiver' && (
              <Link
                href="/caregiver/login"
                className={`inline-flex min-h-10 items-center rounded-xl border px-3 text-xs font-semibold ${
                  portal === 'clinician'
                    ? 'border-white/25 text-white hover:bg-white/10'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-base)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                }`}
              >
                Caregiver Login
              </Link>
            )}
            {portal !== 'clinician' && (
              <Link
                href="/clinician/login"
                className="inline-flex min-h-10 items-center rounded-xl border border-[var(--brand-primary)] bg-[var(--bg-elevated)] px-3 text-xs font-semibold text-[var(--brand-primary)] hover:bg-[var(--bg-mint-panel)]"
              >
                Clinician System
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
        <div className={portal === 'clinician' ? 'rounded-3xl border border-[#1b3c53]/25 bg-[#e3eef5] p-4 sm:p-6' : 'mint-bento p-4 sm:p-6'}>
          <div className="clinical-card p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]">
                  <PortalIcon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${meta.accentBadgeClass}`}>
                    <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                    {meta.badgeLabel}
                  </span>
                  <h1 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold">
                    {mode === 'signin' ? meta.headingSignIn : meta.headingSignUp}
                  </h1>
                  <p className="text-xs text-[var(--text-muted)]">{meta.subtitle}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
                }}
                className="min-h-11 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3.5 text-sm font-semibold text-[var(--brand-accent-text)] hover:bg-[var(--bg-mint-panel)] cursor-pointer"
              >
                {mode === 'signin' ? 'Create account' : 'Have an account? Sign in'}
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-3 text-xs text-[var(--text-muted)]">
              {meta.roleNotice}
            </div>

            {session?.user && (
              <div
                className={`mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${
                  sessionBelongsHere
                    ? 'border-[var(--status-stable)] bg-[var(--status-stable-bg)]'
                    : 'border-[var(--status-watch)] bg-[var(--status-watch-bg)]'
                }`}
              >
                <div
                  className={`flex items-center gap-2 text-sm font-medium ${
                    sessionBelongsHere ? 'text-[var(--status-stable)]' : 'text-[var(--status-watch)]'
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    Currently signed in as <strong>{session.user.name}</strong> ({session.user.email} ·{' '}
                    <span className="capitalize">{(activeSessionRole ?? 'patient').replace('_', ' ')}</span>)
                    {!sessionBelongsHere && ' — submitting below will switch to a new session'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {sessionBelongsHere && (
                    <Link
                      href={getPortalConfig(portalForRole(activeSessionRole)).homeHref}
                      className="inline-flex min-h-10 items-center rounded-lg bg-[var(--brand-primary)] px-3 text-xs font-semibold text-[var(--brand-primary-fg)]"
                    >
                      Open Workspace
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-xs font-semibold text-[var(--text-primary)] cursor-pointer"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Sign out</span>
                  </button>
                </div>
              </div>
            )}

            {/* Portal mode switcher tabs */}
            {portal === 'patient' ? (
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
            ) : (
              <div className="mt-6 grid grid-cols-2 gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-1">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode('signin');
                  }}
                  className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition cursor-pointer ${
                    mode === 'signin'
                      ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  Sign In ({portal === 'clinician' ? 'Clinician' : 'Caregiver'})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode('signup');
                  }}
                  className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition cursor-pointer ${
                    mode === 'signup'
                      ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  New {portal === 'clinician' ? 'Clinician' : 'Caregiver'} Account
                </button>
              </div>
            )}

            {error && (
              <div
                role="alert"
                data-testid="portal-auth-error"
                className="mt-4 flex items-start gap-2 rounded-xl border border-[var(--status-urgent)] bg-[var(--status-urgent-bg)] p-3 text-sm font-medium text-[var(--status-urgent)]"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
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
                  <span>
                    {googleLoading
                      ? 'Redirecting to Google...'
                      : `Continue with Google (${
                          portal === 'clinician'
                            ? 'Clinician'
                            : portal === 'caregiver'
                              ? 'Caregiver'
                              : role === 'caregiver'
                                ? 'Caregiver'
                                : role === 'clinician' || role === 'org_admin'
                                  ? 'Clinician'
                                  : 'Patient'
                        })`}
                  </span>
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
                        and restart the server.
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
                      placeholder={
                        portal === 'clinician'
                          ? 'Dr. Anand Kulkarni'
                          : portal === 'caregiver'
                            ? 'Deepa Rao'
                            : 'Your full name'
                      }
                      className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3.5 text-base"
                    />
                  </div>

                  {portal === 'clinician' && (
                    <div>
                      <label htmlFor="auth-clinic" className="block text-sm font-semibold">
                        Hospital / Department or Registration ID (optional)
                      </label>
                      <div className="relative mt-1">
                        <Building2
                          className="pointer-events-none absolute top-3.5 left-3.5 h-4 w-4 text-[var(--text-muted)]"
                          aria-hidden="true"
                        />
                        <input
                          id="auth-clinic"
                          type="text"
                          value={credentialOrg}
                          onChange={(e) => setCredentialOrg(e.target.value)}
                          placeholder="e.g., Geriatrics · KMC-48219"
                          className="min-h-12 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] pr-3.5 pl-10 text-base"
                        />
                      </div>
                    </div>
                  )}

                  {portal === 'patient' && (
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
                  )}

                  {portal === 'clinician' && (
                    <div>
                      <label htmlFor="auth-role" className="block text-sm font-semibold">
                        Clinical Role
                      </label>
                      <select
                        id="auth-role"
                        value={role === 'org_admin' ? 'org_admin' : 'clinician'}
                        onChange={(e) => setRole(e.target.value as 'clinician' | 'org_admin')}
                        className="mt-1 min-h-12 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3.5 text-base"
                      >
                        <option value="clinician">Clinician (Cohort Triage &amp; FHIR)</option>
                        <option value="org_admin">Org Admin / Clinical Researcher</option>
                      </select>
                    </div>
                  )}
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
