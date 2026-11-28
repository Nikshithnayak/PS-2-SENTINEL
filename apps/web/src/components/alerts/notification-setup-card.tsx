'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, CheckCircle2, ExternalLink, Send, Users } from 'lucide-react';

interface ChannelReadinessResponse {
  patientId: string | null;
  activeCaregivers: number;
  pendingCaregivers: number;
  userPushSubscriptions: number;
  recipientPushSubscriptions: number;
  channels: {
    inApp: { configured: true };
    webPush: { configured: boolean; publicKey: string | null; source: string };
    ntfy: { configured: boolean; topicUrl: string | null };
    email: { configured: boolean; from: string };
    telegram: { configured: boolean };
    sms: { configured: boolean };
  };
}

interface NotificationSetupCardProps {
  patientId?: string | null;
}

const subscribeNoop = () => () => {};

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function NotificationSetupCard({ patientId }: NotificationSetupCardProps) {
  const qc = useQueryClient();
  const [pushFeedback, setPushFeedback] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [subscribing, setSubscribing] = useState(false);

  const pushSupported = useSyncExternalStore(
    subscribeNoop,
    () =>
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window,
    () => false,
  );

  const permissionState = useSyncExternalStore(
    subscribeNoop,
    () => (typeof Notification !== 'undefined' ? Notification.permission : 'default'),
    () => 'default',
  );

  const readinessQuery = useQuery<ChannelReadinessResponse>({
    queryKey: ['alert-channels-readiness', patientId ?? 'auto'],
    queryFn: async () => {
      const qs = patientId ? `?patientId=${encodeURIComponent(patientId)}` : '';
      const res = await fetch(`/api/v1/alerts/channels${qs}`);
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/alerts/channels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patientId: readinessQuery.data?.patientId ?? patientId ?? undefined }),
      });
      const body = (await res.json()) as { error?: string; summary?: string };
      if (!res.ok) throw new Error(body.error ?? 'Test dispatch failed');
      return body;
    },
    onSuccess: (data) => {
      setPushError(null);
      setPushFeedback(data.summary ?? 'Test notification sent across active channels.');
    },
    onError: (err) => {
      setPushFeedback(null);
      setPushError(err instanceof Error ? err.message : 'Unable to send test notification.');
    },
  });

  async function enableBrowserPush() {
    if (!pushSupported) {
      setPushError('Browser Web Push is not supported in this browser.');
      return;
    }
    setSubscribing(true);
    setPushError(null);
    setPushFeedback(null);

    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setPushError(
          'Notification permission was not granted. Allow Notifications in Chrome/Edge site settings and try again.',
        );
        return;
      }

      const publicKey = readinessQuery.data?.channels.webPush.publicKey;
      if (!publicKey) {
        setPushError('Server VAPID public key is not configured for Web Push.');
        return;
      }

      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      const json = sub.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        throw new Error('Browser returned an incomplete push subscription key set.');
      }

      const saveRes = await fetch('/api/v1/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        }),
      });
      if (!saveRes.ok) {
        throw new Error('Failed saving Web Push subscription to SENTINEL.');
      }

      setPushFeedback('Browser push notifications enabled on this device.');
      void qc.invalidateQueries({ queryKey: ['alert-channels-readiness'] });
    } catch (err) {
      setPushError(err instanceof Error ? err.message : 'Failed to enable Web Push alerts.');
    } finally {
      setSubscribing(false);
    }
  }

  const data = readinessQuery.data;
  const userSubscribed = (data?.userPushSubscriptions ?? 0) > 0;
  const recipientSubscribed = (data?.recipientPushSubscriptions ?? 0) > 0;
  const noActiveCaregivers = data && data.activeCaregivers === 0;

  return (
    <section
      aria-label="Caregiver notification channels"
      className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Caregiver Delivery Channels &amp; Browser Push Setup
            </h2>
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Caregivers receive real-time in-app alerts, browser Web Push, and mobile ntfy pushes
            automatically when physiological warnings or &ldquo;I Don&apos;t Feel Well&rdquo; check-ins fire.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void enableBrowserPush()}
            disabled={!pushSupported || subscribing}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-[var(--brand-primary)] px-4 py-1.5 text-xs font-semibold text-[var(--brand-primary-fg)] disabled:opacity-50 cursor-pointer"
          >
            <Bell className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              {subscribing
                ? 'Enabling Push...'
                : userSubscribed
                  ? `Push Active (${data?.userPushSubscriptions} device)`
                  : 'Enable Browser Push Alerts'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3.5 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-50 cursor-pointer"
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{testMutation.isPending ? 'Sending Test...' : 'Send Test Push / ntfy'}</span>
          </button>
        </div>
      </div>

      {data && (
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs">
            <p className="font-semibold text-[var(--text-primary)]">In-App &amp; Live Caregiver Feed</p>
            <p className="mt-0.5 text-[var(--status-stable)] font-medium">
              Live (SSE + Caregiver Console)
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs">
            <p className="font-semibold text-[var(--text-primary)]">Web Push (VAPID Browser Alert)</p>
            <p
              className={`mt-0.5 font-medium ${
                data.channels.webPush.configured && (userSubscribed || recipientSubscribed)
                  ? 'text-[var(--status-stable)]'
                  : 'text-[var(--status-watch)]'
              }`}
            >
              {!data.channels.webPush.configured
                ? 'VAPID keys missing on server'
                : permissionState === 'denied'
                  ? 'Blocked in browser permissions'
                  : recipientSubscribed || userSubscribed
                    ? `Live · ${data.recipientPushSubscriptions} subscribed device(s)`
                    : 'Ready — click "Enable Browser Push Alerts" on caregiver device'}
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs">
            <p className="font-semibold text-[var(--text-primary)]">Mobile Push via ntfy App</p>
            {data.channels.ntfy.configured && data.channels.ntfy.topicUrl ? (
              <p className="mt-0.5 font-medium text-[var(--status-stable)]">
                Live ·{' '}
                <a
                  href={data.channels.ntfy.topicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline"
                >
                  <span>Subscribe Topic</span>
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              </p>
            ) : (
              <p className="mt-0.5 text-[var(--text-muted)]">Not configured (NTFY_TOPIC_URL unset)</p>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs">
            <p className="font-semibold text-[var(--text-primary)]">Caregiver Email (Resend)</p>
            <p
              className={`mt-0.5 font-medium ${
                data.channels.email.configured ? 'text-[var(--status-stable)]' : 'text-[var(--text-muted)]'
              }`}
            >
              {data.channels.email.configured
                ? 'Live external email delivery'
                : 'Local Outbox Only (RESEND_API_KEY not set)'}
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs">
            <p className="font-semibold text-[var(--text-primary)]">Telegram &amp; SMS Gateway</p>
            <p className="mt-0.5 text-[var(--text-muted)]">
              Telegram: {data.channels.telegram.configured ? 'Live' : 'Unset'} · SMS:{' '}
              {data.channels.sms.configured ? 'Live' : 'Disabled'}
            </p>
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs">
            <p className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Linked Care Circle Recipients</span>
            </p>
            <p
              className={`mt-0.5 font-medium ${
                noActiveCaregivers ? 'text-[var(--status-watch)]' : 'text-[var(--status-stable)]'
              }`}
            >
              {data.activeCaregivers} active consented · {data.pendingCaregivers} pending{' '}
              <Link href="/settings/consent" className="ml-1 underline text-[var(--brand-accent-text)]">
                Manage
              </Link>
            </p>
          </div>
        </div>
      )}

      {noActiveCaregivers && (
        <p className="mt-3 rounded-lg border border-[var(--status-watch)] bg-[var(--status-watch-bg)] px-3 py-2 text-xs font-medium text-[var(--status-watch)]">
          No active caregiver has accepted a Care Circle invite yet. The patient must invite their
          caregiver&apos;s email on <strong>/settings/consent</strong> (and the caregiver must sign up
          with that email) before caregiver notifications route to them.
        </p>
      )}

      {pushFeedback && (
        <p
          role="status"
          className="mt-3 flex items-center gap-1.5 rounded-lg bg-[var(--status-stable-bg)] px-3 py-2 text-xs font-medium text-[var(--status-stable)]"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{pushFeedback}</span>
        </p>
      )}

      {pushError && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-[var(--status-urgent-bg)] px-3 py-2 text-xs font-medium text-[var(--status-urgent)]"
        >
          {pushError}
        </p>
      )}
    </section>
  );
}
