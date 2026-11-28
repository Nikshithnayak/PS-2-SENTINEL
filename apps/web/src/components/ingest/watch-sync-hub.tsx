'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import QRCode from 'qrcode';
import {
  Activity,
  Bluetooth,
  Check,
  CheckCircle2,
  Copy,
  Link2,
  QrCode,
  RefreshCw,
  Smartphone,
  Unplug,
  Watch,
  Webhook,
} from 'lucide-react';
import type { VitalSampleInput } from '@sentinel/shared';
import {
  computeRmssdFromRrIntervals,
  parseBleHeartRateMeasurement,
} from '@/lib/ingestion/watch-normalizer';

export interface AdapterHealthSummary {
  configured: boolean;
  provider: string;
  status: string;
  message: string;
}

export interface GoogleConnectorsSummary {
  oauthClientConfigured: boolean;
  callbackUrl: string;
  connections: {
    google_fit: {
      mode: 'google_fit';
      connected: boolean;
      needsReconnect?: boolean;
      scope: string | null;
      hasRefreshToken: boolean;
      expiresAt: string | null;
      updatedAt: string | null;
    };
    google_health_api: {
      mode: 'google_health_api';
      connected: boolean;
      needsReconnect?: boolean;
      scope: string | null;
      hasRefreshToken: boolean;
      expiresAt: string | null;
      updatedAt: string | null;
    };
  };
}

interface WatchSyncHubProps {
  patientId?: string;
  adapters?: AdapterHealthSummary[];
  googleConnectors?: GoogleConnectorsSummary;
  onSyncComplete: () => void;
}

interface GattCharacteristicLike {
  value: DataView | null;
  startNotifications(): Promise<GattCharacteristicLike>;
  readValue(): Promise<DataView>;
  addEventListener(type: string, listener: (ev: { target: GattCharacteristicLike }) => void): void;
  removeEventListener(type: string, listener: (ev: { target: GattCharacteristicLike }) => void): void;
}

interface GattServiceLike {
  getCharacteristic(uuid: string): Promise<GattCharacteristicLike>;
}

interface GattServerLike {
  connected: boolean;
  connect(): Promise<GattServerLike>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<GattServiceLike>;
}

interface BluetoothDeviceLike {
  name?: string;
  gatt?: GattServerLike;
  addEventListener(type: string, listener: () => void): void;
}

interface NavigatorBluetoothLike {
  requestDevice(options: {
    filters: Array<{ services: string[] }>;
    optionalServices?: string[];
  }): Promise<BluetoothDeviceLike>;
}

type CompanionPlatform = 'android' | 'apple' | 'curl';

const subscribeNoop = () => () => {};

export function WatchSyncHub({
  patientId,
  adapters = [],
  googleConnectors,
  onSyncComplete,
}: WatchSyncHubProps) {
  const bleSupported = useSyncExternalStore(
    subscribeNoop,
    () => typeof navigator !== 'undefined' && 'bluetooth' in navigator,
    () => false,
  );
  const origin = useSyncExternalStore(
    subscribeNoop,
    () => (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'),
    () => 'http://localhost:3000',
  );
  const [platform, setPlatform] = useState<CompanionPlatform>('android');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // One-tap Android Health Connect / iPhone direct webhook pairing + QR
  const [directPhoneUrl, setDirectPhoneUrl] = useState<string | null>(null);
  const [directQrDataUrl, setDirectQrDataUrl] = useState<string | null>(null);
  const [creatingPhoneLink, setCreatingPhoneLink] = useState(false);
  const [phoneLinkError, setPhoneLinkError] = useState<string | null>(null);

  // Google Fit / Health OAuth disconnect state
  const [disconnectingMode, setDisconnectingMode] = useState<string | null>(null);

  // BLE Live Watch state
  const [bleStatus, setBleStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [bleMessage, setBleMessage] = useState<string | null>(null);
  const [watchName, setWatchName] = useState<string | null>(null);
  const [batteryPct, setBatteryPct] = useState<number | null>(null);
  const [liveBpm, setLiveBpm] = useState<number | null>(null);
  const [liveHrv, setLiveHrv] = useState<number | null>(null);
  const [contactDetected, setContactDetected] = useState<boolean | null>(null);
  const [bufferedCount, setBufferedCount] = useState(0);
  const [syncingBle, setSyncingBle] = useState(false);

  // Cloud Adapter Sync state
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [providerResult, setProviderResult] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);

  const deviceRef = useRef<BluetoothDeviceLike | null>(null);
  const hrCharRef = useRef<GattCharacteristicLike | null>(null);
  const listenerRef = useRef<((ev: { target: GattCharacteristicLike }) => void) | null>(null);
  const samplesBufferRef = useRef<VitalSampleInput[]>([]);
  const rrWindowRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      if (hrCharRef.current && listenerRef.current) {
        hrCharRef.current.removeEventListener('characteristicvaluechanged', listenerRef.current);
      }
      if (deviceRef.current?.gatt?.connected) {
        deviceRef.current.gatt.disconnect();
      }
    };
  }, []);

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2000);
    } catch {
      setCopiedKey(null);
    }
  }

  async function createDirectPhoneSyncLink() {
    if (!patientId) return;
    setCreatingPhoneLink(true);
    setPhoneLinkError(null);
    try {
      const label = `Health Connect Phone (${new Date().toISOString().slice(0, 10)})`;
      const res = await fetch('/api/v1/api-keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: label }),
      });
      const body = (await res.json()) as { plaintextOnce?: string; error?: string };
      if (!res.ok || !body.plaintextOnce) {
        setPhoneLinkError(body.error ?? 'Unable to create phone sync link.');
        return;
      }
      const syncUrl = `${origin}/api/v1/ingest/watch?apiKey=${encodeURIComponent(body.plaintextOnce)}&evaluate=true`;
      setDirectPhoneUrl(syncUrl);
      const qr = await QRCode.toDataURL(syncUrl, {
        width: 176,
        margin: 1,
        color: { dark: '#102a3c', light: '#ffffff' },
      });
      setDirectQrDataUrl(qr);
      onSyncComplete();
    } catch {
      setPhoneLinkError('Network error generating Health Connect sync link.');
    } finally {
      setCreatingPhoneLink(false);
    }
  }

  async function disconnectGoogle(mode: 'google_fit' | 'google_health_api') {
    setDisconnectingMode(mode);
    setProviderError(null);
    setProviderResult(null);
    try {
      const res = await fetch(`/api/v1/connectors/google/status?mode=${mode}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setProviderError(`Failed to disconnect ${mode}.`);
        return;
      }
      setProviderResult(
        mode === 'google_fit' ? 'Google Fit disconnected.' : 'Google Health v4 disconnected.',
      );
      onSyncComplete();
    } catch {
      setProviderError('Network error disconnecting Google account.');
    } finally {
      setDisconnectingMode(null);
    }
  }

  async function flushBleSamples() {
    if (!patientId || samplesBufferRef.current.length === 0) return;
    const toSend = samplesBufferRef.current.splice(0, samplesBufferRef.current.length);
    setBufferedCount(0);
    setSyncingBle(true);
    try {
      const res = await fetch('/api/v1/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
          samples: toSend,
        }),
      });
      const body = (await res.json()) as { recordsAccepted?: number; error?: string };
      if (!res.ok) {
        samplesBufferRef.current.unshift(...toSend);
        setBufferedCount(samplesBufferRef.current.length);
        setBleStatus('error');
        setBleMessage(body.error ?? 'Failed to save BLE watch samples');
        return;
      }
      setBleMessage(`Saved ${body.recordsAccepted ?? toSend.length} real watch reading(s) cleanly.`);
      onSyncComplete();
    } catch {
      samplesBufferRef.current.unshift(...toSend);
      setBufferedCount(samplesBufferRef.current.length);
      setBleStatus('error');
      setBleMessage('Network error while uploading BLE watch readings.');
    } finally {
      setSyncingBle(false);
    }
  }

  async function connectBleWatch() {
    if (!bleSupported || !patientId) return;
    const bt = (navigator as unknown as { bluetooth: NavigatorBluetoothLike }).bluetooth;
    setBleStatus('connecting');
    setBleMessage(null);

    try {
      const device = await bt.requestDevice({
        filters: [{ services: ['heart_rate'] }],
        optionalServices: ['battery_service'],
      });
      deviceRef.current = device;
      const label = device.name?.trim() || 'Bluetooth Heart Rate Watch';
      setWatchName(label);

      device.addEventListener('gattserverdisconnected', () => {
        setBleStatus('idle');
        setBleMessage(`${label} disconnected.`);
      });

      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error('Watch does not expose a GATT server.');
      }

      try {
        const batterySvc = await server.getPrimaryService('battery_service');
        const batteryChar = await batterySvc.getCharacteristic('battery_level');
        const batteryVal = await batteryChar.readValue();
        setBatteryPct(batteryVal.getUint8(0));
      } catch {
        setBatteryPct(null);
      }

      const hrService = await server.getPrimaryService('heart_rate');
      const hrChar = await hrService.getCharacteristic('heart_rate_measurement');
      hrCharRef.current = hrChar;

      const onPacket = (ev: { target: GattCharacteristicLike }) => {
        const view = ev.target.value;
        if (!view) return;
        const reading = parseBleHeartRateMeasurement(view);
        const recordedAt = new Date().toISOString();

        setLiveBpm(reading.bpm);
        setContactDetected(reading.contactDetected);

        if (reading.rrIntervalsMs.length > 0) {
          rrWindowRef.current = [...rrWindowRef.current, ...reading.rrIntervalsMs].slice(-30);
        }
        const hrv = computeRmssdFromRrIntervals(rrWindowRef.current);
        if (hrv !== null) setLiveHrv(hrv);

        samplesBufferRef.current.push({
          metricType: 'heart_rate',
          value: reading.bpm,
          unit: 'bpm',
          recordedAt,
          context: 'rest',
          source: 'open_ingest_api',
          deviceModel: label,
          isSynthetic: false,
        });
        if (hrv !== null && reading.rrIntervalsMs.length > 0) {
          samplesBufferRef.current.push({
            metricType: 'hrv_rmssd',
            value: hrv,
            unit: 'ms',
            recordedAt,
            context: 'rest',
            source: 'open_ingest_api',
            deviceModel: label,
            isSynthetic: false,
          });
        }
        setBufferedCount(samplesBufferRef.current.length);
      };

      listenerRef.current = onPacket;
      hrChar.addEventListener('characteristicvaluechanged', onPacket);
      await hrChar.startNotifications();
      setBleStatus('connected');
      setBleMessage(`Streaming real Heart Rate (0x180D) from ${label}.`);
    } catch (err) {
      setBleStatus('error');
      setBleMessage(
        err instanceof Error
          ? err.message
          : 'Bluetooth pairing cancelled or watch is not broadcasting BLE Heart Rate.',
      );
    }
  }

  function disconnectBleWatch() {
    if (hrCharRef.current && listenerRef.current) {
      hrCharRef.current.removeEventListener('characteristicvaluechanged', listenerRef.current);
    }
    if (deviceRef.current?.gatt?.connected) {
      deviceRef.current.gatt.disconnect();
    }
    setBleStatus('idle');
    setBleMessage('Disconnected from Bluetooth watch.');
  }

  async function triggerProviderSync(provider: string, unconfiguredMessage?: string) {
    if (!patientId) return;
    setProviderError(null);
    setProviderResult(null);
    if (unconfiguredMessage) {
      setProviderError(
        `${unconfiguredMessage} Push live watch readings with Bluetooth or the Phone Health Connect link until cloud credentials are configured.`,
      );
      return;
    }
    setSyncingProvider(provider);
    try {
      const res = await fetch('/api/v1/sync/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, patientId, hoursBack: 336, evaluate: true }),
      });
      const body = (await res.json()) as {
        error?: string;
        recordsAccepted?: number;
        message?: string;
      };
      if (!res.ok) {
        setProviderError(body.error ?? `Unable to sync ${provider}.`);
        return;
      }
      setProviderResult(
        body.message ?? `Synced ${body.recordsAccepted ?? 0} real sample(s) from ${provider}.`,
      );
      onSyncComplete();
    } catch {
      setProviderError(`Network error syncing ${provider}.`);
    } finally {
      setSyncingProvider(null);
    }
  }

  const webhookUrl = `${origin}/api/v1/ingest/watch`;
  const googleCallbackUrl = googleConnectors?.callbackUrl ?? `${origin}/api/v1/connectors/google/callback`;
  const gfitConnected = googleConnectors?.connections.google_fit.connected ?? false;
  const gfitNeedsReconnect = googleConnectors?.connections.google_fit.needsReconnect ?? false;
  const ghConnected = googleConnectors?.connections.google_health_api.connected ?? false;
  const gOAuthReady = googleConnectors?.oauthClientConfigured ?? true;

  const effectivePatientId = patientId ?? '<YOUR_PATIENT_ID>';
  const sampleJson = JSON.stringify(
    {
      patientId: effectivePatientId,
      deviceModel: 'Smartwatch Companion',
      context: 'rest',
      heartRate: 72,
      spo2: 98,
      hrv: 42,
      steps: 4200,
      sleepMinutes: 430,
      evaluate: true,
    },
    null,
    2,
  );
  const curlSnippet = `curl -X POST "${webhookUrl}" \\\n  -H "Content-Type: application/json" \\\n  -H "x-api-key: <YOUR_SENTINEL_API_KEY>" \\\n  -d '${JSON.stringify({
    deviceModel: 'My Smartwatch',
    heartRate: 72,
    spo2: 98,
    steps: 4200,
    evaluate: true,
  })}'`;

  return (
    <section
      aria-labelledby="watch-sync-heading"
      className="mint-bento mb-6 p-5 sm:p-6"
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-semibold text-[var(--brand-primary)]">
            <Watch className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Direct Phone &amp; Watch Connections · Zero CSV Needed</span>
          </div>
          <h2
            id="watch-sync-heading"
            className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold text-[var(--text-primary)]"
          >
            Connect Google Fit, Health Connect &amp; Any Smartwatch Directly
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--text-muted)]">
            Link Google Fit with 1-click OAuth, pair Android Health Connect via automatic background
            sync, or stream live Bluetooth Heart Rate directly from your watch — no file downloads
            required.
          </p>
        </div>

        {patientId && (
          <button
            type="button"
            onClick={() => void copyText('patientId', patientId)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
          >
            {copiedKey === 'patientId' ? (
              <Check className="h-4 w-4 text-[var(--status-stable)]" aria-hidden="true" />
            ) : (
              <Copy className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden="true" />
            )}
            <span>
              {copiedKey === 'patientId'
                ? 'Patient ID Copied'
                : `Copy Patient ID (${patientId.slice(0, 8)}...)`}
            </span>
          </button>
        )}
      </div>

      {/* Primary Row: Direct Google Fit / Google Health OAuth + Direct Android Health Connect Phone Bridge */}
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        {/* Direct Google Fit & Google Health Cloud OAuth */}
        <article className="clinical-card flex min-w-0 flex-col justify-between overflow-hidden p-5">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-mint-panel)] text-[var(--brand-primary)]">
                  <Link2 className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">
                    Google Fit &amp; Google Health (1-Click OAuth)
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Authorize directly with your Google account — auto-refreshes tokens securely
                  </p>
                </div>
              </div>
              <span
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  gfitNeedsReconnect
                    ? 'border-[var(--status-watch)] bg-[var(--status-watch-bg)] text-[var(--status-watch)]'
                    : gfitConnected || ghConnected
                      ? 'border-[var(--status-stable)] bg-[var(--status-stable-bg)] text-[var(--status-stable)]'
                      : 'border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                }`}
              >
                {gfitNeedsReconnect
                  ? 'Reconnect Required'
                  : gfitConnected || ghConnected
                    ? 'Connected'
                    : 'Ready to Connect'}
              </span>
            </div>

            <div className="mt-4 space-y-2.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3.5 text-xs text-[var(--text-muted)]">
              <p className="text-[var(--text-primary)]">
                Pulls heart rate, steps, SpO₂, body temperature, blood pressure, glucose, and sleep
                sessions directly from Google without downloading any files.
              </p>
              {gfitNeedsReconnect && (
                <p className="rounded-lg border border-[var(--status-watch)] bg-[var(--status-watch-bg)] px-3 py-2 text-[var(--status-watch)]">
                  Your previous Google Fit authorization expired without a refresh token. Click
                  <strong> Reconnect Google Fit</strong> below to grant offline sync access.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {gfitConnected && !gfitNeedsReconnect ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void triggerProviderSync('google_fit')}
                      disabled={!patientId || syncingProvider !== null}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--brand-primary)] px-4 py-2 text-xs font-semibold text-[var(--brand-primary-fg)] disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${syncingProvider === 'google_fit' ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                      />
                      <span>
                        {syncingProvider === 'google_fit' ? 'Syncing Google Fit...' : 'Sync Google Fit Now'}
                      </span>
                    </button>
                    <a
                      href={patientId ? `/api/v1/connectors/google/connect?mode=fit&patientId=${encodeURIComponent(patientId)}` : '/api/v1/connectors/google/connect?mode=fit'}
                      aria-disabled={!gOAuthReady}
                      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] ${!gOAuthReady ? 'pointer-events-none opacity-50' : ''}`}
                    >
                      <span>Re-authorize</span>
                    </a>
                    <button
                      type="button"
                      onClick={() => void disconnectGoogle('google_fit')}
                      disabled={disconnectingMode !== null}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
                    >
                      <Unplug className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Disconnect</span>
                    </button>
                  </>
                ) : (
                  <>
                    <a
                      href={patientId ? `/api/v1/connectors/google/connect?mode=fit&patientId=${encodeURIComponent(patientId)}` : '/api/v1/connectors/google/connect?mode=fit'}
                      aria-disabled={!gOAuthReady}
                      className={`inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--brand-primary)] px-5 py-2 text-xs font-semibold text-[var(--brand-primary-fg)] ${!gOAuthReady ? 'pointer-events-none opacity-50' : ''}`}
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      <span>{gfitNeedsReconnect ? 'Reconnect Google Fit' : 'Connect Google Fit'}</span>
                    </a>
                    {gfitNeedsReconnect && (
                      <button
                        type="button"
                        onClick={() => void disconnectGoogle('google_fit')}
                        disabled={disconnectingMode !== null}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
                      >
                        <Unplug className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Disconnect</span>
                      </button>
                    )}
                  </>
                )}

                {ghConnected ? (
                  <button
                    type="button"
                    onClick={() => void triggerProviderSync('google_health_api')}
                    disabled={!patientId || syncingProvider !== null}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] cursor-pointer"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Sync Google Health v4</span>
                  </button>
                ) : (
                  <a
                    href={patientId ? `/api/v1/connectors/google/connect?mode=health&patientId=${encodeURIComponent(patientId)}` : '/api/v1/connectors/google/connect?mode=health'}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
                  >
                    <span>Connect Google Health v4</span>
                  </a>
                )}
              </div>
            </div>
          </div>

          <details className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3.5 py-2.5 text-xs text-[var(--text-muted)]">
            <summary className="cursor-pointer font-semibold text-[var(--text-primary)]">
              Google Cloud OAuth &amp; Callback Setup Details
            </summary>
            <div className="mt-2 space-y-1.5">
              <p>
                Add this callback URL to <strong>Authorized redirect URIs</strong> in Google Cloud
                Console and enable the <strong>Fitness API</strong> (or <strong>Google Health API</strong>):
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2">
                <code className="min-w-0 break-all font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-primary)]">
                  {googleCallbackUrl}
                </code>
                <button
                  type="button"
                  onClick={() => void copyText('gcallback', googleCallbackUrl)}
                  className="shrink-0 font-semibold text-[var(--brand-accent-text)] hover:underline cursor-pointer"
                >
                  {copiedKey === 'gcallback' ? 'Copied' : 'Copy URI'}
                </button>
              </div>
              <p>
                Google is sunsetting legacy Google Fit REST endpoints at the end of 2026; if your
                Google Cloud project cannot enable Fitness API, use the{' '}
                <strong>Android Health Connect Direct Bridge</strong> next to this card for zero-quota
                background sync from your phone.
              </p>
            </div>
          </details>
        </article>

        {/* Direct Android Health Connect Phone Bridge (One-Tap Authenticated Link + QR) */}
        <article className="clinical-card flex min-w-0 flex-col justify-between overflow-hidden p-5">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-mint-panel)] text-[var(--brand-primary)]">
                  <QrCode className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">
                    Android Health Connect (Direct Phone Sync)
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Automatic phone-to-SENTINEL sync from Samsung Health, Fit, Noise, boAt &amp; Pixel
                  </p>
                </div>
              </div>
              <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)]">
                Zero CSV
              </span>
            </div>

            <p className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 text-xs text-[var(--text-muted)]">
              Android keeps Health Connect on your phone (Chrome cannot read it directly). Pair once
              with free <strong>HC Webhook</strong> (open-source Android bridge) to sync Heart Rate,
              HRV, SpO₂, Sleep &amp; Steps automatically every hour:
            </p>

            {directPhoneUrl ? (
              <div className="mt-3 flex flex-col items-start gap-3 rounded-xl border border-[var(--status-stable)] bg-[var(--bg-base)] p-3.5 sm:flex-row sm:items-center">
                {directQrDataUrl && (
                  <img
                    src={directQrDataUrl}
                    alt="QR code for direct Android Health Connect and watch sync URL"
                    className="h-32 w-32 shrink-0 rounded-lg border border-[var(--border-subtle)] bg-white p-1.5"
                  />
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-xs font-semibold text-[var(--status-stable)]">
                    Direct Phone Sync URL Ready (Scan or Paste in HC Webhook / Shortcuts)
                  </p>
                  <code className="block max-w-full break-all rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2 font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-primary)]">
                    {directPhoneUrl}
                  </code>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void copyText('directPhoneUrl', directPhoneUrl)}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-[var(--brand-primary)] px-4 py-1.5 text-xs font-semibold text-[var(--brand-primary-fg)] cursor-pointer"
                    >
                      {copiedKey === 'directPhoneUrl' ? (
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      <span>
                        {copiedKey === 'directPhoneUrl' ? 'Link Copied' : 'Copy Direct Sync Link'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <ol className="mt-3 list-decimal space-y-1 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3.5 pl-7 text-xs text-[var(--text-primary)]">
                <li>
                  Click <strong>Generate Direct Phone Sync Link &amp; QR</strong> below.
                </li>
                <li>
                  Open free <strong>HC Webhook</strong> on Android (or{' '}
                  <strong>Health Auto Export</strong> on iPhone) and grant Health Connect permissions.
                </li>
                <li>Scan the QR or paste the link once — vitals push in the background automatically.</li>
              </ol>
            )}

            {phoneLinkError && (
              <p className="mt-2 rounded-lg bg-[var(--status-urgent-bg)] px-3 py-2 text-xs font-medium text-[var(--status-urgent)]">
                {phoneLinkError}
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => void createDirectPhoneSyncLink()}
              disabled={!patientId || creatingPhoneLink}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--brand-primary)] px-5 py-2 text-xs font-semibold text-[var(--brand-primary-fg)] disabled:opacity-50 cursor-pointer"
            >
              <QrCode className="h-4 w-4" aria-hidden="true" />
              <span>
                {creatingPhoneLink
                  ? 'Creating Direct Link...'
                  : directPhoneUrl
                    ? 'Regenerate Phone Sync Link & QR'
                    : 'Generate Direct Phone Sync Link & QR'}
              </span>
            </button>
          </div>
        </article>
      </div>

      {/* Secondary Row: Direct BLE Watch Streaming + Webhook Payload Inspector & Cloud Bridges */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Card 1: Direct Browser Web Bluetooth Watch Stream */}
        <article className="clinical-card flex min-w-0 flex-col justify-between overflow-hidden p-5">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-mint-panel)] text-[var(--brand-primary)]">
                  <Bluetooth className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">
                    Direct Bluetooth Watch (BLE 0x180D)
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Garmin, Polar, Coros, Amazfit, Noise/boAt HR broadcast, Wear OS &amp; straps
                  </p>
                </div>
              </div>
              <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1 text-xs font-semibold text-[var(--text-primary)]">
                {bleStatus === 'connected'
                  ? 'Live Stream'
                  : bleSupported
                    ? 'Browser Ready'
                    : 'Unsupported Browser'}
              </span>
            </div>

            {bleStatus === 'connected' || liveBpm !== null ? (
              <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3.5">
                <div>
                  <p className="text-xs font-semibold text-[var(--text-muted)]">Heart Rate</p>
                  <p className="mt-0.5 font-[family-name:var(--font-mono)] text-2xl font-bold text-[var(--text-primary)] tabular-nums">
                    {liveBpm !== null ? `${liveBpm}` : '--'}{' '}
                    <span className="text-xs font-normal text-[var(--text-muted)]">bpm</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[var(--text-muted)]">Live HRV</p>
                  <p className="mt-0.5 font-[family-name:var(--font-mono)] text-2xl font-bold text-[var(--text-primary)] tabular-nums">
                    {liveHrv !== null ? `${liveHrv}` : '--'}{' '}
                    <span className="text-xs font-normal text-[var(--text-muted)]">ms</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-[var(--text-muted)]">Watch Status</p>
                  <p className="mt-1 text-xs font-semibold text-[var(--text-primary)]">
                    {contactDetected === false ? 'Low Contact' : 'On Wrist'}
                    {batteryPct !== null ? ` · ${batteryPct}%` : ''}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] truncate">
                    {watchName ?? 'BLE Sensor'}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3.5 text-xs text-[var(--text-muted)]">
                {bleSupported
                  ? 'Enable "Heart Rate Broadcast" on your watch, then pair directly from Chrome on Android or desktop. Real packets (BPM + RR-interval HRV) buffer below and upload with zero synthetic data.'
                  : 'Web Bluetooth requires Chrome or Edge on Android/Desktop over localhost or HTTPS. Use Android Health Connect or Apple Watch on iOS above/right.'}
              </p>
            )}

            {bleMessage && (
              <p
                role="status"
                className={`mt-3 rounded-lg px-3 py-2 text-xs font-medium ${
                  bleStatus === 'error'
                    ? 'bg-[var(--status-urgent-bg)] text-[var(--status-urgent)]'
                    : 'bg-[var(--status-stable-bg)] text-[var(--status-stable)]'
                }`}
              >
                {bleMessage}
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2.5">
            {bleStatus === 'connected' ? (
              <>
                <button
                  type="button"
                  onClick={() => void flushBleSamples()}
                  disabled={syncingBle || bufferedCount === 0}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--brand-primary)] px-4 py-2 text-xs font-semibold text-[var(--brand-primary-fg)] disabled:opacity-50 cursor-pointer"
                >
                  <Activity className="h-4 w-4" aria-hidden="true" />
                  <span>
                    {syncingBle
                      ? 'Saving...'
                      : `Save ${bufferedCount} Real Reading(s) to SENTINEL`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={disconnectBleWatch}
                  className="inline-flex min-h-11 items-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
                >
                  Disconnect Watch
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void connectBleWatch()}
                disabled={!bleSupported || !patientId || bleStatus === 'connecting'}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--brand-primary)] px-5 py-2 text-xs font-semibold text-[var(--brand-primary-fg)] disabled:opacity-50 cursor-pointer"
              >
                <Bluetooth className="h-4 w-4" aria-hidden="true" />
                <span>
                  {bleStatus === 'connecting' ? 'Pairing Watch...' : 'Pair Bluetooth Watch'}
                </span>
              </button>
            )}
          </div>
        </article>

        {/* Card 2: Companion Webhook Specs & Cloud Adapters */}
        <article className="clinical-card flex min-w-0 flex-col justify-between overflow-hidden p-5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-mint-panel)] text-[var(--brand-primary)]">
                  <Webhook className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">
                    Companion Webhook &amp; Cloud Sync
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Accepts HC Webhook, iOS Health Auto Export &amp; custom JSON directly
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => void copyText('webhook', webhookUrl)}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] cursor-pointer"
              >
                {copiedKey === 'webhook' ? (
                  <Check className="h-3.5 w-3.5 text-[var(--status-stable)]" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-[var(--brand-primary)]" aria-hidden="true" />
                )}
                <span>{copiedKey === 'webhook' ? 'URL Copied' : 'Copy Webhook URL'}</span>
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Watch companion guide">
              {(
                [
                  { id: 'android', label: 'Android Health Connect' },
                  { id: 'apple', label: 'Apple Watch (iOS)' },
                  { id: 'curl', label: 'Watch JSON / curl' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={platform === tab.id}
                  onClick={() => setPlatform(tab.id)}
                  className={`min-h-10 rounded-full px-3.5 py-1.5 text-xs font-semibold cursor-pointer ${
                    platform === tab.id
                      ? 'bg-[var(--brand-primary)] text-[var(--brand-primary-fg)]'
                      : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {platform === 'android' && (
              <ol className="mt-3 list-decimal space-y-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 pl-7 text-xs text-[var(--text-primary)]">
                <li>
                  Natively decodes <strong>HC Webhook</strong> JSON (
                  <code className="font-[family-name:var(--font-mono)]">
                    heart_rate, oxygen_saturation, sleep_sessions, steps, heart_rate_variability_rmssd
                  </code>
                  ).
                </li>
                <li>
                  Authenticates via query param (<code className="font-[family-name:var(--font-mono)]">?apiKey=snt_live_...</code>),{' '}
                  <code className="font-[family-name:var(--font-mono)]">Authorization: Bearer</code>, or{' '}
                  <code className="font-[family-name:var(--font-mono)]">x-api-key</code>.
                </li>
                <li>
                  Or use <strong>Connect Google Fit</strong> above for direct cloud pulling when enabled.
                </li>
              </ol>
            )}

            {platform === 'apple' && (
              <ol className="mt-3 list-decimal space-y-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 pl-7 text-xs text-[var(--text-primary)]">
                <li>
                  Use the <strong>Generate Direct Phone Sync Link &amp; QR</strong> button above (no
                  manual header configuration required).
                </li>
                <li>
                  Install <strong>Health Auto Export</strong> on iPhone or create an{' '}
                  <strong>Apple Shortcuts</strong> automation reading Apple Watch Heart Rate, HRV,
                  SpO₂, Steps, and Sleep.
                </li>
                <li>
                  Set method to <code className="font-[family-name:var(--font-mono)]">POST</code>{' '}
                  with JSON export enabled — Health Auto Export metrics normalize automatically.
                </li>
              </ol>
            )}

            {platform === 'curl' && (
              <div className="mt-3 min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
                  <span className="min-w-0 break-all font-[family-name:var(--font-mono)]">
                    POST {webhookUrl}
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyText('curl', curlSnippet)}
                    className="shrink-0 font-semibold text-[var(--brand-accent-text)] hover:underline cursor-pointer"
                  >
                    {copiedKey === 'curl' ? 'Copied command' : 'Copy command'}
                  </button>
                </div>
                <pre className="mt-1.5 max-w-full overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-primary)]">
                  {sampleJson}
                </pre>
              </div>
            )}
          </div>

          <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)]">
                <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Cloud Bridges (Pull Last 48h)</span>
              </span>
              <div className="flex flex-wrap gap-2">
                {adapters.map((adapter) => {
                  const unconfMsg =
                    adapter.provider === 'open_wearables' && !adapter.configured
                      ? adapter.message
                      : undefined;
                  const buttonLabel =
                    adapter.provider === 'google_fit'
                      ? 'Sync Google Fit'
                      : adapter.provider === 'google_health_api'
                        ? 'Sync Google Health'
                        : 'Sync Open Wearables';
                  return (
                    <button
                      key={adapter.provider}
                      type="button"
                      onClick={() => void triggerProviderSync(adapter.provider, unconfMsg)}
                      disabled={!patientId || syncingProvider !== null}
                      className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] disabled:opacity-50 cursor-pointer"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${
                          syncingProvider === adapter.provider ? 'animate-spin' : ''
                        }`}
                        aria-hidden="true"
                      />
                      <span>
                        {syncingProvider === adapter.provider ? 'Syncing...' : buttonLabel}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {providerResult && (
              <p className="mt-2 rounded-lg bg-[var(--status-stable-bg)] px-3 py-1.5 text-xs font-medium text-[var(--status-stable)]">
                {providerResult}
              </p>
            )}
            {providerError && (
              <p className="mt-2 rounded-lg bg-[var(--status-watch-bg)] px-3 py-1.5 text-xs font-medium text-[var(--status-watch)]">
                {providerError}
              </p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
}
