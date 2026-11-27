'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Activity,
  Bluetooth,
  Check,
  Copy,
  RefreshCw,
  Smartphone,
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

interface WatchSyncHubProps {
  patientId?: string;
  adapters?: AdapterHealthSummary[];
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

type CompanionPlatform = 'curl' | 'apple' | 'android';

const subscribeNoop = () => () => {};

export function WatchSyncHub({ patientId, adapters = [], onSyncComplete }: WatchSyncHubProps) {
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
  const [platform, setPlatform] = useState<CompanionPlatform>('curl');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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

      // Optional battery read (never blocks HR streaming if watch omits battery_service)
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

  async function triggerProviderSync(adapter: AdapterHealthSummary) {
    if (!patientId) return;
    setProviderError(null);
    setProviderResult(null);
    if (!adapter.configured) {
      setProviderError(
        `${adapter.message} Push live watch readings with Bluetooth or the Webhook tab above until cloud credentials are configured.`,
      );
      return;
    }
    setSyncingProvider(adapter.provider);
    try {
      const res = await fetch('/api/v1/sync/provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: adapter.provider, patientId, hoursBack: 24, evaluate: true }),
      });
      const body = (await res.json()) as {
        error?: string;
        recordsAccepted?: number;
        message?: string;
      };
      if (!res.ok) {
        setProviderError(body.error ?? `Unable to sync ${adapter.provider}.`);
        return;
      }
      setProviderResult(
        body.message ?? `Synced ${body.recordsAccepted ?? 0} real sample(s) from ${adapter.provider}.`,
      );
      onSyncComplete();
    } catch {
      setProviderError(`Network error syncing ${adapter.provider}.`);
    } finally {
      setSyncingProvider(null);
    }
  }

  const webhookUrl = `${origin}/api/v1/ingest/watch`;
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
      className="mint-bento mb-6 p-6"
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-semibold text-[var(--brand-primary)]">
            <Watch className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Universal Smartwatch Sync · Any Watch</span>
          </div>
          <h2
            id="watch-sync-heading"
            className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold text-[var(--text-primary)]"
          >
            Connect Any Smartwatch Directly or via Companion Webhook
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--text-muted)]">
            Pair via live Bluetooth Heart Rate broadcast, push automated snapshots from iPhone Apple
            Shortcuts / Android Health Connect / Gadgetbridge, or pull from Open Wearables &amp;
            Google Health cloud bridges.
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

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Card 1: Direct Browser Web Bluetooth Watch Stream */}
        <article className="clinical-card flex flex-col justify-between p-5">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--bg-mint-panel)] text-[var(--brand-primary)]">
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
                  ? 'Enable "Heart Rate Broadcast" on your watch, then pair directly from Chrome/Edge. Real packets (BPM + RR-interval HRV) buffer below and upload with zero synthetic data.'
                  : 'Web Bluetooth requires Chrome or Microsoft Edge on desktop/Android over localhost or HTTPS. For Apple Watch, Samsung Galaxy Watch without BLE HR broadcast, or iOS Safari, use the Companion Webhook on the right.'}
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

        {/* Card 2: Any Phone / Watch Companion Webhook + Cloud Adapters */}
        <article className="clinical-card flex flex-col justify-between p-5">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--bg-mint-panel)] text-[var(--brand-primary)]">
                  <Webhook className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-base font-semibold text-[var(--text-primary)]">
                    Companion Webhook &amp; Cloud Sync
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    POST any watch JSON from iOS Shortcuts, Android Health Connect, or curl
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
                  { id: 'curl', label: 'Watch JSON / curl' },
                  { id: 'apple', label: 'Apple Watch (iOS)' },
                  { id: 'android', label: 'Android / Wear OS / Band' },
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

            {platform === 'curl' && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                  <span className="font-[family-name:var(--font-mono)]">
                    POST {webhookUrl}
                  </span>
                  <button
                    type="button"
                    onClick={() => void copyText('curl', curlSnippet)}
                    className="font-semibold text-[var(--brand-accent-text)] hover:underline cursor-pointer"
                  >
                    {copiedKey === 'curl' ? 'Copied command' : 'Copy command'}
                  </button>
                </div>
                <pre className="mt-1.5 overflow-x-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3 font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-primary)]">
                  {sampleJson}
                </pre>
              </div>
            )}

            {platform === 'apple' && (
              <ol className="mt-3 list-decimal space-y-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 pl-7 text-xs text-[var(--text-primary)]">
                <li>
                  Generate a device key below in <strong>Wearable API Keys</strong> and copy it.
                </li>
                <li>
                  Install <strong>Health Auto Export</strong> on iPhone or create an{' '}
                  <strong>Apple Shortcuts</strong> automation reading Apple Watch Heart Rate, HRV,
                  SpO₂, Steps, and Sleep.
                </li>
                <li>
                  Set method to <code className="font-[family-name:var(--font-mono)]">POST</code>{' '}
                  <code className="font-[family-name:var(--font-mono)]">{webhookUrl}</code> with
                  header <code className="font-[family-name:var(--font-mono)]">x-api-key</code> and
                  JSON export enabled — Health Auto Export metrics normalize automatically.
                </li>
              </ol>
            )}

            {platform === 'android' && (
              <ol className="mt-3 list-decimal space-y-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] p-4 pl-7 text-xs text-[var(--text-primary)]">
                <li>
                  Works with Galaxy Watch, Pixel Watch, Amazfit, Xiaomi, Garmin, OnePlus &amp;
                  Noise/boAt synced into <strong>Android Health Connect</strong> or{' '}
                  <strong>Gadgetbridge</strong>.
                </li>
                <li>
                  Configure HTTP Sync / Tasker / Home Assistant webhook to{' '}
                  <code className="font-[family-name:var(--font-mono)]">POST</code> flat fields (
                  <code className="font-[family-name:var(--font-mono)]">
                    heartRate, spo2, steps, sleepMinutes, hrv
                  </code>
                  ) with your <code className="font-[family-name:var(--font-mono)]">x-api-key</code>{' '}
                  to <code className="font-[family-name:var(--font-mono)]">{webhookUrl}</code>.
                </li>
                <li>
                  Or use the <strong>Open Wearables</strong> / <strong>Google Health</strong> sync
                  actions below for cloud-to-cloud pulling.
                </li>
              </ol>
            )}
          </div>

          <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)]">
                <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Cloud Bridges (Pull Last 24h)</span>
              </span>
              <div className="flex flex-wrap gap-2">
                {adapters.map((adapter) => (
                  <button
                    key={adapter.provider}
                    type="button"
                    onClick={() => void triggerProviderSync(adapter)}
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
                      {syncingProvider === adapter.provider
                        ? 'Syncing...'
                        : adapter.provider === 'google_health_api'
                          ? 'Sync Google Health'
                          : 'Sync Open Wearables'}
                    </span>
                  </button>
                ))}
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
