/**
 * Web Bluetooth smartwatch discovery, GATT capability inspection, transient connect
 * retry, and human-readable troubleshooting diagnostics.
 */

export type BleScanMode = 'all_devices' | 'health_services';

export interface GattCharacteristicLike {
  value: DataView | null;
  startNotifications(): Promise<GattCharacteristicLike>;
  stopNotifications?(): Promise<GattCharacteristicLike>;
  readValue(): Promise<DataView>;
  addEventListener(type: string, listener: (ev: { target: GattCharacteristicLike }) => void): void;
  removeEventListener(
    type: string,
    listener: (ev: { target: GattCharacteristicLike }) => void,
  ): void;
}

export interface GattServiceLike {
  uuid?: string;
  getCharacteristic(uuid: string | number): Promise<GattCharacteristicLike>;
}

export interface GattServerLike {
  connected: boolean;
  connect(): Promise<GattServerLike>;
  disconnect(): void;
  getPrimaryService(uuid: string | number): Promise<GattServiceLike>;
  getPrimaryServices?(): Promise<GattServiceLike[]>;
}

export interface BluetoothDeviceLike {
  id?: string;
  name?: string;
  gatt?: GattServerLike;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener?(type: string, listener: () => void): void;
}

export type RequestDeviceOptions =
  | {
      acceptAllDevices: true;
      optionalServices?: Array<string | number>;
    }
  | {
      filters: Array<{ services: Array<string | number> } | { namePrefix: string }>;
      optionalServices?: Array<string | number>;
    };

export interface NavigatorBluetoothLike {
  requestDevice(options: RequestDeviceOptions): Promise<BluetoothDeviceLike>;
  getAvailability?(): Promise<boolean>;
  addEventListener?(type: 'availabilitychanged', listener: (ev: { value?: boolean }) => void): void;
  removeEventListener?(
    type: 'availabilitychanged',
    listener: (ev: { value?: boolean }) => void,
  ): void;
}

export interface BleEnvironmentStatus {
  supported: boolean;
  adapterAvailable: boolean;
  badgeLabel: string;
  reason: string | null;
}

export const BLE_STANDARD_SERVICES = {
  HEART_RATE: 'heart_rate',
  BATTERY: 'battery_service',
  PULSE_OXIMETER: 0x1822,
  HEALTH_THERMOMETER: 0x1809,
  DEVICE_INFORMATION: 0x180a,
  GENERIC_ACCESS: 0x1800,
  FITNESS_MACHINE: 0x1826,
  RUNNING_SPEED: 0x1814,
} as const;

export const BLE_CHARACTERISTICS = {
  HEART_RATE_MEASUREMENT: 'heart_rate_measurement',
  BATTERY_LEVEL: 'battery_level',
  PLX_SPOT_CHECK: 0x2a5e,
  PLX_CONTINUOUS: 0x2a5f,
  MODEL_NUMBER: 0x2a24,
  MANUFACTURER_NAME: 0x2a29,
} as const;

const VENDOR_SERVICE_LABELS: ReadonlyArray<{ uuid: string; label: string }> = [
  { uuid: '0000fee0-0000-1000-8000-00805f9b34fb', label: 'Amazfit / Zepp / Mi Band' },
  { uuid: '0000fee1-0000-1000-8000-00805f9b34fb', label: 'Huami / Mi Auth' },
  { uuid: '0000fee7-0000-1000-8000-00805f9b34fb', label: 'OEM Fitness Band (0xFEE7)' },
  { uuid: '0000feea-0000-1000-8000-00805f9b34fb', label: 'OEM Smartwatch (0xFEEA)' },
  { uuid: '000056ff-0000-1000-8000-00805f9b34fb', label: 'Realme / Dizo / OEM Watch' },
  { uuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', label: 'Nordic UART Wearable Bridge' },
  { uuid: 'adabfb00-6e7d-4601-bda2-bffaa68956ba', label: 'Fitbit Proprietary GATT' },
];

export const BLE_OPTIONAL_SERVICES: Array<string | number> = [
  BLE_STANDARD_SERVICES.HEART_RATE,
  BLE_STANDARD_SERVICES.BATTERY,
  BLE_STANDARD_SERVICES.PULSE_OXIMETER,
  BLE_STANDARD_SERVICES.HEALTH_THERMOMETER,
  BLE_STANDARD_SERVICES.DEVICE_INFORMATION,
  BLE_STANDARD_SERVICES.GENERIC_ACCESS,
  BLE_STANDARD_SERVICES.FITNESS_MACHINE,
  BLE_STANDARD_SERVICES.RUNNING_SPEED,
  ...VENDOR_SERVICE_LABELS.map((v) => v.uuid),
];

/**
 * Builds Chrome Web Bluetooth `requestDevice()` options.
 * Defaulting to `acceptAllDevices: true` avoids empty pickers when consumer watches
 * (Noise, boAt, Fire-Boltt, Galaxy Watch, Amazfit, Wear OS) omit 0x180D from ADV packets.
 */
export function buildRequestDeviceOptions(scanMode: BleScanMode): RequestDeviceOptions {
  if (scanMode === 'health_services') {
    return {
      filters: [
        { services: [BLE_STANDARD_SERVICES.HEART_RATE] },
        { services: [BLE_STANDARD_SERVICES.PULSE_OXIMETER] },
      ],
      optionalServices: BLE_OPTIONAL_SERVICES,
    };
  }
  return {
    acceptAllDevices: true,
    optionalServices: BLE_OPTIONAL_SERVICES,
  };
}

/**
 * Checks whether Chrome/Edge Web Bluetooth and an active OS Bluetooth adapter are ready.
 */
export async function checkBleAvailability(
  nav: { bluetooth?: NavigatorBluetoothLike } | undefined,
  isSecureContext = true,
): Promise<BleEnvironmentStatus> {
  if (!isSecureContext) {
    return {
      supported: false,
      adapterAvailable: false,
      badgeLabel: 'HTTPS Required',
      reason:
        'Web Bluetooth requires HTTPS or localhost. Open the deployed HTTPS URL instead of a LAN IP address.',
    };
  }

  if (!nav || !nav.bluetooth) {
    return {
      supported: false,
      adapterAvailable: false,
      badgeLabel: 'Unsupported Browser',
      reason:
        'Web Bluetooth is unavailable here (blocked on iPhone/iPad browsers and Firefox). Use Chrome or Edge on Android, Windows, or macOS — or pair via Android Health Connect / Apple Watch above.',
    };
  }

  if (typeof nav.bluetooth.getAvailability === 'function') {
    try {
      const available = await nav.bluetooth.getAvailability();
      if (!available) {
        return {
          supported: true,
          adapterAvailable: false,
          badgeLabel: 'Bluetooth Radio Off',
          reason:
            'No active Bluetooth radio was detected on this device. Turn on Bluetooth in Windows/Android Settings and verify Chrome Bluetooth permission is allowed.',
        };
      }
    } catch {
      // Some browser flags omit getAvailability; proceed optimistically.
    }
  }

  return {
    supported: true,
    adapterAvailable: true,
    badgeLabel: 'Adapter Ready',
    reason: null,
  };
}

/**
 * Retries transient Windows/Android GATT connection failures once before surfacing an error.
 */
export async function connectGattWithRetry(
  device: BluetoothDeviceLike,
  attempts = 2,
  retryDelayMs = 450,
): Promise<GattServerLike> {
  if (!device.gatt) {
    throw new Error('Selected Bluetooth device does not expose a GATT server.');
  }

  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const server = await device.gatt.connect();
      return server;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        (err instanceof Error && err.name === 'NetworkError') ||
        /disconnected|connection failed|gatt|timeout/i.test(msg);
      if (!transient || i === attempts - 1) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Unable to establish GATT connection with the Bluetooth watch.');
}

async function readUtf8Characteristic(
  service: GattServiceLike,
  uuid: string | number,
): Promise<string | null> {
  try {
    const ch = await service.getCharacteristic(uuid);
    const dv = await ch.readValue();
    const text = new TextDecoder('utf-8')
      .decode(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength))
      .replaceAll('\0', '')
      .trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export function classifyVendorUuids(serviceUuids: string[]): string | null {
  const lower = new Set(serviceUuids.map((u) => u.toLowerCase()));
  const matched = VENDOR_SERVICE_LABELS.filter((entry) => lower.has(entry.uuid)).map(
    (entry) => entry.label,
  );
  if (matched.length > 0) return matched.join(', ');
  if (serviceUuids.length > 0) {
    return `custom GATT (${serviceUuids.slice(0, 3).join(', ')})`;
  }
  return null;
}

export interface DiscoveredWatchServices {
  watchLabel: string;
  batteryPct: number | null;
  hrChar: GattCharacteristicLike | null;
  plxChar: GattCharacteristicLike | null;
  discoveredServiceUuids: string[];
  vendorDiagnosis: string | null;
}

/**
 * Inspects standard Heart Rate (0x180D), Pulse Oximeter (0x1822), Device Info (0x180A),
 * Battery (0x180F), and any discovered vendor GATT services on a connected watch.
 */
export async function discoverWatchServices(
  server: GattServerLike,
  rawDeviceName?: string,
): Promise<DiscoveredWatchServices> {
  let manufacturer: string | null = null;
  let model: string | null = null;
  let batteryPct: number | null = null;

  try {
    const devInfo = await server.getPrimaryService(BLE_STANDARD_SERVICES.DEVICE_INFORMATION);
    manufacturer = await readUtf8Characteristic(devInfo, BLE_CHARACTERISTICS.MANUFACTURER_NAME);
    model = await readUtf8Characteristic(devInfo, BLE_CHARACTERISTICS.MODEL_NUMBER);
  } catch {
    // Device Information (0x180A) is optional on trackers.
  }

  try {
    const batterySvc = await server.getPrimaryService(BLE_STANDARD_SERVICES.BATTERY);
    const batteryChar = await batterySvc.getCharacteristic(BLE_CHARACTERISTICS.BATTERY_LEVEL);
    const val = await batteryChar.readValue();
    batteryPct = val.getUint8(0);
  } catch {
    batteryPct = null;
  }

  const trimmedName = rawDeviceName?.trim();
  const deviceInfoName = [manufacturer, model].filter(Boolean).join(' ').trim();
  const watchLabel = trimmedName || deviceInfoName || 'Bluetooth Watch';

  let hrChar: GattCharacteristicLike | null = null;
  try {
    const hrSvc = await server.getPrimaryService(BLE_STANDARD_SERVICES.HEART_RATE);
    hrChar = await hrSvc.getCharacteristic(BLE_CHARACTERISTICS.HEART_RATE_MEASUREMENT);
  } catch {
    hrChar = null;
  }

  let plxChar: GattCharacteristicLike | null = null;
  try {
    const plxSvc = await server.getPrimaryService(BLE_STANDARD_SERVICES.PULSE_OXIMETER);
    try {
      plxChar = await plxSvc.getCharacteristic(BLE_CHARACTERISTICS.PLX_CONTINUOUS);
    } catch {
      plxChar = await plxSvc.getCharacteristic(BLE_CHARACTERISTICS.PLX_SPOT_CHECK);
    }
  } catch {
    plxChar = null;
  }

  let discoveredServiceUuids: string[] = [];
  if (typeof server.getPrimaryServices === 'function') {
    try {
      const svcs = await server.getPrimaryServices();
      discoveredServiceUuids = svcs
        .map((s) => s.uuid)
        .filter((u): u is string => typeof u === 'string' && u.length > 0);
    } catch {
      discoveredServiceUuids = [];
    }
  }

  const vendorDiagnosis =
    !hrChar && !plxChar ? classifyVendorUuids(discoveredServiceUuids) : null;

  return {
    watchLabel,
    batteryPct,
    hrChar,
    plxChar,
    discoveredServiceUuids,
    vendorDiagnosis,
  };
}

/**
 * Translates raw Web Bluetooth browser exceptions into actionable pairing fixes.
 */
export function formatBleConnectionError(err: unknown, scanMode: BleScanMode): string {
  const name = err instanceof Error ? err.name : '';
  const rawMessage = err instanceof Error ? err.message : String(err ?? '');

  if (name === 'NotFoundError' || /cancelled|no bluetooth devices/i.test(rawMessage)) {
    if (scanMode === 'health_services') {
      return 'No watch advertising open HR (0x180D) / SpO₂ (0x1822) was found or selected. Switch scan mode to "All Nearby Watches" below (most smartwatches hide 0x180D until selected), disconnect the watch from your phone companion app if pairing from a laptop, and keep the watch awake.';
    }
    return 'Pairing cancelled or no watch appeared in Chrome’s scanner. Make sure: (1) the watch screen is awake or in pairing mode, (2) it is disconnected from any other phone/Windows Bluetooth settings (watches allow only 1 active BLE link at a time), and (3) Location/Bluetooth permission is allowed for Chrome.';
  }

  if (name === 'SecurityError') {
    return 'Bluetooth access was blocked by browser permissions. Click the tune/lock icon in Chrome’s address bar and allow Bluetooth devices for this site.';
  }

  if (name === 'NetworkError' || /disconnected|connection failed/i.test(rawMessage)) {
    return 'Bluetooth GATT connection dropped mid-handshake. Keep your watch wrist screen awake, close its companion app temporarily so it does not steal the link, and tap Pair again.';
  }

  if (name === 'NotSupportedError') {
    return 'This browser or OS Bluetooth adapter blocked BLE GATT access. Use Chrome or Edge on Android, Windows, or macOS with Bluetooth enabled.';
  }

  return rawMessage || 'Unable to pair Bluetooth watch. Switch to "All Nearby Watches" or sync via Health Connect above.';
}
