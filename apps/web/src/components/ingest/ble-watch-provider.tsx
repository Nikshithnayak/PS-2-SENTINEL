'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { VitalSampleInput } from '@sentinel/shared';
import {
  buildRequestDeviceOptions,
  checkBleAvailability,
  connectGattWithRetry,
  discoverWatchServices,
  formatBleConnectionError,
  type BleEnvironmentStatus,
  type BleScanMode,
  type BluetoothDeviceLike,
  type GattCharacteristicLike,
  type NavigatorBluetoothLike,
} from '@/lib/ingestion/ble-watch';
import {
  computeRmssdFromRrIntervals,
  parseBleHeartRateMeasurement,
  parseBlePulseOximeterMeasurement,
} from '@/lib/ingestion/watch-normalizer';

export type BleConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface BleWatchContextValue {
  bleSupported: boolean;
  bleScanMode: BleScanMode;
  setBleScanMode: (mode: BleScanMode) => void;
  bleEnv: BleEnvironmentStatus;
  bleStatus: BleConnectionStatus;
  bleMessage: string | null;
  watchName: string | null;
  batteryPct: number | null;
  liveBpm: number | null;
  liveHrv: number | null;
  liveSpo2: number | null;
  contactDetected: boolean | null;
  bufferedCount: number;
  autoSavedCount: number;
  syncingBle: boolean;
  connectBleWatch: (patientId: string, overrideMode?: BleScanMode) => Promise<void>;
  disconnectBleWatch: () => void;
  flushBleSamples: (silent?: boolean) => Promise<void>;
}

const BleWatchContext = createContext<BleWatchContextValue | null>(null);

const subscribeNoop = () => () => {};

export function useBleWatch(): BleWatchContextValue {
  const ctx = useContext(BleWatchContext);
  if (!ctx) {
    throw new Error('useBleWatch must be used inside BleWatchProvider');
  }
  return ctx;
}

export function BleWatchProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const bleSupported = useSyncExternalStore(
    subscribeNoop,
    () => typeof navigator !== 'undefined' && 'bluetooth' in navigator,
    () => false,
  );

  const [bleScanMode, setBleScanMode] = useState<BleScanMode>('all_devices');
  const [bleEnv, setBleEnv] = useState<BleEnvironmentStatus>({
    supported: bleSupported,
    adapterAvailable: bleSupported,
    badgeLabel: bleSupported ? 'Browser Ready' : 'Unsupported Browser',
    reason: null,
  });
  const [bleStatus, setBleStatus] = useState<BleConnectionStatus>('idle');
  const [bleMessage, setBleMessage] = useState<string | null>(null);
  const [watchName, setWatchName] = useState<string | null>(null);
  const [batteryPct, setBatteryPct] = useState<number | null>(null);
  const [liveBpm, setLiveBpm] = useState<number | null>(null);
  const [liveHrv, setLiveHrv] = useState<number | null>(null);
  const [liveSpo2, setLiveSpo2] = useState<number | null>(null);
  const [contactDetected, setContactDetected] = useState<boolean | null>(null);
  const [bufferedCount, setBufferedCount] = useState(0);
  const [autoSavedCount, setAutoSavedCount] = useState(0);
  const [syncingBle, setSyncingBle] = useState(false);

  const activePatientIdRef = useRef<string | null>(null);
  const deviceRef = useRef<BluetoothDeviceLike | null>(null);
  const hrCharRef = useRef<GattCharacteristicLike | null>(null);
  const plxCharRef = useRef<GattCharacteristicLike | null>(null);
  const hrListenerRef = useRef<((ev: { target: GattCharacteristicLike }) => void) | null>(null);
  const plxListenerRef = useRef<((ev: { target: GattCharacteristicLike }) => void) | null>(null);
  const disconnectListenerRef = useRef<(() => void) | null>(null);
  const samplesBufferRef = useRef<VitalSampleInput[]>([]);
  const rrWindowRef = useRef<number[]>([]);
  const lastSampleMsRef = useRef<number>(0);
  const flushingBleRef = useRef<boolean>(false);
  const userDisconnectedRef = useRef<boolean>(false);
  const hasFlushedInitialRef = useRef<boolean>(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalidateDashboardQueries = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['quality-status'] });
    void qc.invalidateQueries({ queryKey: ['patient-dashboard'] });
    void qc.invalidateQueries({ queryKey: ['dashboard-patient'] });
    void qc.invalidateQueries({ queryKey: ['today-series'] });
    void qc.invalidateQueries({ queryKey: ['vitals-series-explorer'] });
  }, [qc]);

  const nextMonotonicIso = useCallback(() => {
    const now = Date.now();
    const nextMs = now > lastSampleMsRef.current ? now : lastSampleMsRef.current + 1;
    lastSampleMsRef.current = nextMs;
    return new Date(nextMs).toISOString();
  }, []);

  const detachCharacteristicListeners = useCallback(() => {
    if (hrCharRef.current && hrListenerRef.current) {
      hrCharRef.current.removeEventListener('characteristicvaluechanged', hrListenerRef.current);
      void hrCharRef.current.stopNotifications?.().catch(() => {});
    }
    if (plxCharRef.current && plxListenerRef.current) {
      plxCharRef.current.removeEventListener('characteristicvaluechanged', plxListenerRef.current);
      void plxCharRef.current.stopNotifications?.().catch(() => {});
    }
    hrCharRef.current = null;
    plxCharRef.current = null;
    hrListenerRef.current = null;
    plxListenerRef.current = null;
  }, []);

  const cleanupBleHandles = useCallback(
    (clearDevice = true) => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      detachCharacteristicListeners();
      if (deviceRef.current && disconnectListenerRef.current) {
        deviceRef.current.removeEventListener?.(
          'gattserverdisconnected',
          disconnectListenerRef.current,
        );
      }
      if (deviceRef.current?.gatt?.connected) {
        deviceRef.current.gatt.disconnect();
      }
      if (clearDevice) {
        disconnectListenerRef.current = null;
        deviceRef.current = null;
      }
      rrWindowRef.current = [];
    },
    [detachCharacteristicListeners],
  );

  const flushBleSamples = useCallback(
    async (silent = false) => {
      const patientId = activePatientIdRef.current;
      if (!patientId || samplesBufferRef.current.length === 0 || flushingBleRef.current) return;
      flushingBleRef.current = true;
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
            evaluate: true,
            samples: toSend,
          }),
        });
        const body = (await res.json()) as { recordsAccepted?: number; error?: string };
        if (!res.ok) {
          samplesBufferRef.current.unshift(...toSend);
          setBufferedCount(samplesBufferRef.current.length);
          if (!silent) {
            setBleMessage(body.error ?? 'Failed to save BLE watch samples');
          }
          return;
        }
        const saved = body.recordsAccepted ?? toSend.length;
        hasFlushedInitialRef.current = true;
        setAutoSavedCount((prev) => prev + saved);
        if (!silent) {
          setBleMessage(`Saved ${saved} real watch reading(s) to Health Overview.`);
        }
        invalidateDashboardQueries();
      } catch {
        samplesBufferRef.current.unshift(...toSend);
        setBufferedCount(samplesBufferRef.current.length);
        if (!silent) {
          setBleMessage('Network error while uploading BLE watch readings.');
        }
      } finally {
        flushingBleRef.current = false;
        setSyncingBle(false);
      }
    },
    [invalidateDashboardQueries],
  );

  const bindWatchStreams = useCallback(
    async (device: BluetoothDeviceLike, scanModeOnError: BleScanMode) => {
      const server = await connectGattWithRetry(device, 2, 450);
      const discovered = await discoverWatchServices(server, device.name);
      const watchLabel = discovered.watchLabel;
      setWatchName(watchLabel);
      setBatteryPct(discovered.batteryPct);

      if (!discovered.hrChar && !discovered.plxChar) {
        userDisconnectedRef.current = true;
        cleanupBleHandles(true);
        setBleStatus('error');
        const batteryHint =
          discovered.batteryPct !== null ? ` (Battery ${discovered.batteryPct}%)` : '';
        const vendorHint = discovered.vendorDiagnosis
          ? `Detected ${discovered.vendorDiagnosis} rather than open BLE Heart Rate (0x180D) or Pulse Oximeter (0x1822).`
          : 'This watch did not expose open BLE Heart Rate (0x180D) or Pulse Oximeter (0x1822) GATT services.';
        setBleMessage(
          `Bluetooth connected to "${watchLabel}"${batteryHint} — ${vendorHint} Turn on "Heart Rate Broadcast" in your watch settings if supported (Garmin/Coros/Polar/Amazfit/Wear OS), or keep it paired with your phone app and sync via Android Health Connect / Google Fit.`,
        );
        return false;
      }

      const activeStreams: string[] = [];

      const queueAndMaybeFlush = () => {
        setBufferedCount(samplesBufferRef.current.length);
        if (!hasFlushedInitialRef.current || samplesBufferRef.current.length >= 5) {
          void flushBleSamples(true);
        }
      };

      if (discovered.hrChar) {
        hrCharRef.current = discovered.hrChar;
        const onHrPacket = (ev: { target: GattCharacteristicLike }) => {
          const view = ev.target.value;
          if (!view) return;
          const reading = parseBleHeartRateMeasurement(view);
          const recordedAt = nextMonotonicIso();

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
            deviceModel: watchLabel,
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
              deviceModel: watchLabel,
              isSynthetic: false,
            });
          }
          queueAndMaybeFlush();
        };
        hrListenerRef.current = onHrPacket;
        discovered.hrChar.addEventListener('characteristicvaluechanged', onHrPacket);
        await discovered.hrChar.startNotifications();
        activeStreams.push('Heart Rate (0x180D)');
      }

      if (discovered.plxChar) {
        plxCharRef.current = discovered.plxChar;
        const onPlxPacket = (ev: { target: GattCharacteristicLike }) => {
          const view = ev.target.value;
          if (!view) return;
          const reading = parseBlePulseOximeterMeasurement(view);
          const recordedAt = nextMonotonicIso();

          if (reading.spo2 !== null) {
            setLiveSpo2(reading.spo2);
            samplesBufferRef.current.push({
              metricType: 'spo2',
              value: reading.spo2,
              unit: '%',
              recordedAt,
              context: 'rest',
              source: 'open_ingest_api',
              deviceModel: watchLabel,
              isSynthetic: false,
            });
          }
          if (reading.pulseRate !== null && !discovered.hrChar) {
            setLiveBpm(reading.pulseRate);
            samplesBufferRef.current.push({
              metricType: 'heart_rate',
              value: reading.pulseRate,
              unit: 'bpm',
              recordedAt,
              context: 'rest',
              source: 'open_ingest_api',
              deviceModel: watchLabel,
              isSynthetic: false,
            });
          }
          queueAndMaybeFlush();
        };
        plxListenerRef.current = onPlxPacket;
        discovered.plxChar.addEventListener('characteristicvaluechanged', onPlxPacket);
        await discovered.plxChar.startNotifications();
        activeStreams.push('SpO₂ (0x1822)');
      }

      setBleStatus('connected');
      setBleMessage(
        `Connected to ${watchLabel} (${activeStreams.join(' + ')}) — stays connected across pages and syncs live to Health Overview.`,
      );
      void scanModeOnError;
      return true;
    },
    [cleanupBleHandles, flushBleSamples, nextMonotonicIso],
  );

  const attemptAutoReconnect = useCallback(
    async (device: BluetoothDeviceLike, attempt = 1) => {
      if (userDisconnectedRef.current || deviceRef.current !== device) return;
      setBleStatus('reconnecting');
      setBleMessage(`Reconnecting to ${device.name?.trim() || 'Bluetooth Watch'} (attempt ${attempt}/3)...`);
      try {
        detachCharacteristicListeners();
        await bindWatchStreams(device, bleScanMode);
      } catch {
        if (userDisconnectedRef.current || deviceRef.current !== device) return;
        if (attempt < 3) {
          const delayMs = attempt === 1 ? 1500 : attempt === 2 ? 3000 : 5000;
          reconnectTimerRef.current = setTimeout(() => {
            void attemptAutoReconnect(device, attempt + 1);
          }, delayMs);
        } else {
          setBleStatus('error');
          setBleMessage(
            `${device.name?.trim() || 'Bluetooth Watch'} went out of range or slept. Keep the watch awake and click Scan & Pair to reconnect.`,
          );
        }
      }
    },
    [bindWatchStreams, bleScanMode, detachCharacteristicListeners],
  );

  const connectBleWatch = useCallback(
    async (patientId: string, overrideMode?: BleScanMode) => {
      if (!patientId) return;
      activePatientIdRef.current = patientId;
      const scanMode = overrideMode ?? bleScanMode;
      if (overrideMode) setBleScanMode(overrideMode);

      const nav =
        typeof navigator !== 'undefined'
          ? (navigator as unknown as { bluetooth?: NavigatorBluetoothLike })
          : undefined;
      const secure = typeof window !== 'undefined' ? window.isSecureContext : true;
      const freshEnv = await checkBleAvailability(nav, secure);
      setBleEnv(freshEnv);

      if (!freshEnv.supported || !nav?.bluetooth) {
        setBleStatus('error');
        setBleMessage(freshEnv.reason ?? 'Web Bluetooth is unavailable in this browser.');
        return;
      }

      if (!freshEnv.adapterAvailable) {
        setBleStatus('error');
        setBleMessage(
          freshEnv.reason ??
            'Bluetooth adapter is turned off. Enable Bluetooth in Settings and tap Pair again.',
        );
        return;
      }

      userDisconnectedRef.current = true;
      cleanupBleHandles(true);
      userDisconnectedRef.current = false;
      hasFlushedInitialRef.current = false;
      setBleStatus('connecting');
      setBleMessage(null);
      setLiveSpo2(null);
      setLiveBpm(null);
      setLiveHrv(null);
      setAutoSavedCount(0);

      try {
        const device = await nav.bluetooth.requestDevice(buildRequestDeviceOptions(scanMode));
        deviceRef.current = device;
        const initialLabel = device.name?.trim() || 'Bluetooth Watch';
        setWatchName(initialLabel);

        const onDisconnected = () => {
          if (samplesBufferRef.current.length > 0) {
            void flushBleSamples(true);
          }
          if (userDisconnectedRef.current) {
            setBleStatus('idle');
            setBleMessage(`Disconnected from ${initialLabel}.`);
          } else {
            void attemptAutoReconnect(device, 1);
          }
        };
        disconnectListenerRef.current = onDisconnected;
        device.addEventListener('gattserverdisconnected', onDisconnected);

        await bindWatchStreams(device, scanMode);
      } catch (err) {
        userDisconnectedRef.current = true;
        cleanupBleHandles(true);
        setBleStatus('error');
        setBleMessage(formatBleConnectionError(err, scanMode));
      }
    },
    [attemptAutoReconnect, bindWatchStreams, bleScanMode, cleanupBleHandles, flushBleSamples],
  );

  const disconnectBleWatch = useCallback(() => {
    userDisconnectedRef.current = true;
    if (samplesBufferRef.current.length > 0) {
      void flushBleSamples(true);
    }
    cleanupBleHandles(true);
    setBleStatus('idle');
    setBleMessage('Disconnected from Bluetooth watch.');
  }, [cleanupBleHandles, flushBleSamples]);

  // Periodic background flush every 10s while connected so Health Overview stays fresh
  useEffect(() => {
    if (bleStatus !== 'connected') return;
    const timer = setInterval(() => {
      if (samplesBufferRef.current.length > 0) {
        void flushBleSamples(true);
      }
    }, 10_000);
    return () => clearInterval(timer);
  }, [bleStatus, flushBleSamples]);

  // Environment Bluetooth adapter monitor & browser tab unload safety flush
  useEffect(() => {
    let active = true;
    const nav =
      typeof navigator !== 'undefined'
        ? (navigator as unknown as { bluetooth?: NavigatorBluetoothLike })
        : undefined;
    const secure = typeof window !== 'undefined' ? window.isSecureContext : true;

    const refreshAvailability = () => {
      void checkBleAvailability(nav, secure).then((env) => {
        if (active) setBleEnv(env);
      });
    };
    refreshAvailability();

    const onAvailabilityChange = () => refreshAvailability();
    nav?.bluetooth?.addEventListener?.('availabilitychanged', onAvailabilityChange);

    const onPageHide = () => {
      const pid = activePatientIdRef.current;
      if (pid && samplesBufferRef.current.length > 0) {
        const trailing = samplesBufferRef.current.splice(0, samplesBufferRef.current.length);
        void fetch('/api/v1/ingest', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patientId: pid,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
            evaluate: true,
            samples: trailing,
          }),
        }).catch(() => {});
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', onPageHide);
    }

    return () => {
      active = false;
      nav?.bluetooth?.removeEventListener?.('availabilitychanged', onAvailabilityChange);
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onPageHide);
      }
    };
  }, []);

  return (
    <BleWatchContext.Provider
      value={{
        bleSupported,
        bleScanMode,
        setBleScanMode,
        bleEnv,
        bleStatus,
        bleMessage,
        watchName,
        batteryPct,
        liveBpm,
        liveHrv,
        liveSpo2,
        contactDetected,
        bufferedCount,
        autoSavedCount,
        syncingBle,
        connectBleWatch,
        disconnectBleWatch,
        flushBleSamples,
      }}
    >
      {children}
    </BleWatchContext.Provider>
  );
}
