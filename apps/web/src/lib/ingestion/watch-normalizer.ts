import {
  ActivityContextSchema,
  CANONICAL_UNITS,
  MetricTypeSchema,
  ProviderSourceSchema,
  VitalSampleInputSchema,
  type ActivityContext,
  type MetricType,
  type ProviderSource,
  type VitalSampleInput,
} from '@sentinel/shared';

export interface BleHeartRateReading {
  bpm: number;
  contactSupported: boolean;
  contactDetected: boolean;
  rrIntervalsMs: number[];
  hrvRmssdMs: number | null;
}

/**
 * Computes Root Mean Square of Successive Differences (RMSSD) in milliseconds
 * from adjacent RR intervals, filtering non-physiological intervals outside 300–2000ms.
 */
export function computeRmssdFromRrIntervals(rrIntervalsMs: number[]): number | null {
  const valid = rrIntervalsMs.filter((rr) => Number.isFinite(rr) && rr >= 300 && rr <= 2000);
  if (valid.length < 3) return null;

  let sumSqDiff = 0;
  let count = 0;
  for (let i = 1; i < valid.length; i++) {
    const diff = valid[i]! - valid[i - 1]!;
    sumSqDiff += diff * diff;
    count++;
  }
  if (count === 0) return null;
  return Number(Math.sqrt(sumSqDiff / count).toFixed(2));
}

/**
 * Parses a Bluetooth SIG Heart Rate Measurement characteristic (0x2A37) packet
 * broadcast by any standard BLE smartwatch, fitness tracker, or chest strap (service 0x180D).
 */
export function parseBleHeartRateMeasurement(view: DataView): BleHeartRateReading {
  if (view.byteLength < 2) {
    throw new Error('Malformed BLE 0x2A37 packet: expected at least 2 bytes');
  }

  const flags = view.getUint8(0);
  const isUint16 = (flags & 0x01) !== 0;
  const contactSupported = (flags & 0x04) !== 0;
  const contactDetected = !contactSupported || (flags & 0x02) !== 0;
  const hasEnergyExpended = (flags & 0x08) !== 0;
  const hasRrIntervals = (flags & 0x10) !== 0;

  let offset = 1;
  const bpm = isUint16 ? view.getUint16(offset, true) : view.getUint8(offset);
  offset += isUint16 ? 2 : 1;

  if (hasEnergyExpended && offset + 2 <= view.byteLength) {
    offset += 2;
  }

  const rrIntervalsMs: number[] = [];
  if (hasRrIntervals) {
    while (offset + 2 <= view.byteLength) {
      const rr1024 = view.getUint16(offset, true);
      offset += 2;
      if (rr1024 > 0) {
        rrIntervalsMs.push(Number(((rr1024 / 1024) * 1000).toFixed(2)));
      }
    }
  }

  return {
    bpm,
    contactSupported,
    contactDetected,
    rrIntervalsMs,
    hrvRmssdMs: computeRmssdFromRrIntervals(rrIntervalsMs),
  };
}

const FLAT_FIELD_TO_METRIC: ReadonlyArray<{
  keys: readonly string[];
  metricType: MetricType;
  defaultUnit: string;
}> = [
  { keys: ['heartRate', 'heart_rate', 'hr', 'bpm'], metricType: 'heart_rate', defaultUnit: 'bpm' },
  {
    keys: ['restingHeartRate', 'resting_heart_rate', 'rhr'],
    metricType: 'resting_heart_rate',
    defaultUnit: 'bpm',
  },
  { keys: ['hrv', 'hrvRmssd', 'hrv_rmssd', 'rmssd'], metricType: 'hrv_rmssd', defaultUnit: 'ms' },
  {
    keys: ['spo2', 'oxygenSaturation', 'oxygen_saturation', 'bloodOxygen', 'blood_oxygen'],
    metricType: 'spo2',
    defaultUnit: '%',
  },
  {
    keys: ['respiratoryRate', 'respiratory_rate', 'breathingRate', 'breathing_rate'],
    metricType: 'respiratory_rate',
    defaultUnit: 'breaths/min',
  },
  { keys: ['steps', 'stepCount', 'step_count'], metricType: 'steps', defaultUnit: 'count' },
  {
    keys: ['sleepMinutes', 'sleep_duration_min', 'minutesAsleep', 'sleep_minutes'],
    metricType: 'sleep_duration_min',
    defaultUnit: 'min',
  },
  {
    keys: ['sleepEfficiency', 'sleep_efficiency'],
    metricType: 'sleep_efficiency',
    defaultUnit: '%',
  },
  {
    keys: ['sleepAwakenings', 'sleep_awakenings'],
    metricType: 'sleep_awakenings',
    defaultUnit: 'count',
  },
  {
    keys: ['skinTempDeviation', 'skin_temp_deviation'],
    metricType: 'skin_temp_deviation',
    defaultUnit: 'degC',
  },
  {
    keys: ['bodyTemperature', 'body_temperature', 'temperature'],
    metricType: 'body_temperature',
    defaultUnit: 'degC',
  },
  {
    keys: ['systolicBp', 'systolic_bp', 'systolic'],
    metricType: 'systolic_bp',
    defaultUnit: 'mmHg',
  },
  {
    keys: ['bloodGlucose', 'blood_glucose', 'glucose'],
    metricType: 'blood_glucose',
    defaultUnit: 'mg/dL',
  },
  { keys: ['weightKg', 'weight_kg', 'weight'], metricType: 'weight_kg', defaultUnit: 'kg' },
  { keys: ['afibBurden', 'afib_burden'], metricType: 'afib_burden', defaultUnit: '%' },
];

const HEALTH_EXPORT_METRIC_ALIASES: Record<string, MetricType> = {
  heart_rate: 'heart_rate',
  resting_heart_rate: 'resting_heart_rate',
  heart_rate_variability: 'hrv_rmssd',
  heart_rate_variability_rmssd: 'hrv_rmssd',
  hrv_rmssd: 'hrv_rmssd',
  blood_oxygen_saturation: 'spo2',
  oxygen_saturation: 'spo2',
  spo2: 'spo2',
  respiratory_rate: 'respiratory_rate',
  step_count: 'steps',
  steps: 'steps',
  sleep_analysis: 'sleep_duration_min',
  sleep_duration: 'sleep_duration_min',
  sleep_duration_min: 'sleep_duration_min',
  sleep_efficiency: 'sleep_efficiency',
  body_temperature: 'body_temperature',
  apple_sleeping_wrist_temperature: 'skin_temp_deviation',
  skin_temperature_deviation: 'skin_temp_deviation',
  skin_temp_deviation: 'skin_temp_deviation',
  blood_pressure_systolic: 'systolic_bp',
  systolic_bp: 'systolic_bp',
  blood_glucose: 'blood_glucose',
  weight_body_mass: 'weight_kg',
  weight_kg: 'weight_kg',
  atrial_fibrillation_burden: 'afib_burden',
  afib_burden: 'afib_burden',
};

function toOffsetIso(raw: unknown, fallbackIso: string): string {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const d = new Date(raw.trim());
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallbackIso;
}

function parseContext(raw: unknown): ActivityContext {
  const parsed = ActivityContextSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'unknown';
}

function parseSource(raw: unknown): ProviderSource {
  if (raw === 'synthetic_sim') return 'open_ingest_api';
  const parsed = ProviderSourceSchema.safeParse(raw);
  return parsed.success ? parsed.data : 'open_ingest_api';
}

function resolveAliasMetricType(rawName: string): MetricType | null {
  const direct = MetricTypeSchema.safeParse(rawName);
  if (direct.success) return direct.data;
  const slug = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return HEALTH_EXPORT_METRIC_ALIASES[slug] ?? null;
}

export interface NormalizedWatchPayload {
  patientId?: string;
  idempotencyKey?: string;
  source: ProviderSource;
  evaluate: boolean;
  samples: VitalSampleInput[];
  ignoredFields: string[];
}

function buildValidatedSample(candidate: Record<string, unknown>): VitalSampleInput | null {
  const parsed = VitalSampleInputSchema.safeParse({
    ...candidate,
    isSynthetic: false,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Normalizes smartwatch webhook payloads from companion apps (iOS Apple Shortcuts /
 * Health Auto Export, Android Health Connect / Tasker / Gadgetbridge, or custom REST JSON)
 * into verified non-synthetic `VitalSampleInput` records.
 */
export function normalizeWatchPayload(rawBody: unknown): NormalizedWatchPayload {
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return {
      source: 'open_ingest_api',
      evaluate: false,
      samples: [],
      ignoredFields: ['root'],
    };
  }

  const root = rawBody as Record<string, unknown>;
  const nowIso = new Date().toISOString();
  const rootPatientId = typeof root.patientId === 'string' ? root.patientId : undefined;
  const idempotencyKey =
    typeof root.idempotencyKey === 'string' && root.idempotencyKey.length >= 8
      ? root.idempotencyKey.slice(0, 128)
      : undefined;
  const rootSource = parseSource(root.source);
  const evaluate = root.evaluate === true;
  const rootTimestamp = toOffsetIso(root.recordedAt ?? root.timestamp ?? root.date, nowIso);
  const rootDevice =
    typeof root.deviceModel === 'string'
      ? root.deviceModel
      : typeof root.device === 'string'
        ? root.device
        : typeof root.watch === 'string'
          ? root.watch
          : undefined;
  const rootContext = parseContext(root.context);

  const samples: VitalSampleInput[] = [];
  const ignoredFields: string[] = [];

  // 1. Canonical or simplified `samples` array
  if (Array.isArray(root.samples)) {
    for (const item of root.samples) {
      if (!item || typeof item !== 'object') {
        ignoredFields.push('samples[]');
        continue;
      }
      const entry = item as Record<string, unknown>;
      const rawMetric = typeof entry.metricType === 'string' ? entry.metricType : String(entry.metric ?? '');
      const metricType = resolveAliasMetricType(rawMetric);
      const val = Number(entry.value ?? entry.qty);
      if (!metricType || !Number.isFinite(val)) {
        ignoredFields.push(rawMetric || 'samples[]');
        continue;
      }
      const unit =
        typeof entry.unit === 'string' && entry.unit.trim().length > 0
          ? entry.unit.trim()
          : CANONICAL_UNITS[metricType];
      const validated = buildValidatedSample({
        metricType,
        value: val,
        unit,
        recordedAt: toOffsetIso(entry.recordedAt ?? entry.timestamp ?? entry.date, rootTimestamp),
        context: entry.context ? parseContext(entry.context) : rootContext,
        source: entry.source ? parseSource(entry.source) : rootSource,
        deviceModel: typeof entry.deviceModel === 'string' ? entry.deviceModel : rootDevice,
        externalId: typeof entry.externalId === 'string' ? entry.externalId : undefined,
      });
      if (validated) samples.push(validated);
      else ignoredFields.push(metricType);
    }
  }

  // 2. iOS Health Auto Export JSON webhook shape: { data: { metrics: [...] } }
  const dataObj =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : null;
  if (dataObj && Array.isArray(dataObj.metrics)) {
    for (const m of dataObj.metrics) {
      if (!m || typeof m !== 'object') continue;
      const metricGroup = m as Record<string, unknown>;
      const metricName = typeof metricGroup.name === 'string' ? metricGroup.name : '';
      const metricType = resolveAliasMetricType(metricName);
      if (!metricType) {
        if (metricName) ignoredFields.push(metricName);
        continue;
      }
      const groupUnit =
        typeof metricGroup.units === 'string' && metricGroup.units.trim().length > 0
          ? metricGroup.units.trim()
          : CANONICAL_UNITS[metricType];
      const points = Array.isArray(metricGroup.data) ? metricGroup.data : [];
      for (const p of points) {
        if (!p || typeof p !== 'object') continue;
        const point = p as Record<string, unknown>;
        const rawVal = point.qty ?? point.Avg ?? point.value ?? point.asleep ?? point.totalSleep;
        const numericVal = Number(rawVal);
        if (!Number.isFinite(numericVal)) {
          ignoredFields.push(metricName);
          continue;
        }
        const validated = buildValidatedSample({
          metricType,
          value: numericVal,
          unit: typeof point.units === 'string' ? point.units : groupUnit,
          recordedAt: toOffsetIso(point.date ?? point.startDate ?? point.endDate, rootTimestamp),
          context: rootContext,
          source: rootSource,
          deviceModel: typeof point.source === 'string' ? point.source : rootDevice,
        });
        if (validated) samples.push(validated);
      }
    }
  }

  // 3. Flat smartwatch JSON snapshot ({ heartRate, spo2, steps, sleepMinutes, ... })
  for (const fieldDef of FLAT_FIELD_TO_METRIC) {
    let rawValue: unknown;
    let matchedKey: string | undefined;
    for (const k of fieldDef.keys) {
      if (root[k] !== undefined && root[k] !== null && root[k] !== '') {
        rawValue = root[k];
        matchedKey = k;
        break;
      }
    }
    if (rawValue === undefined || !matchedKey) continue;

    const numericVal = Number(rawValue);
    if (!Number.isFinite(numericVal)) {
      ignoredFields.push(matchedKey);
      continue;
    }

    const explicitUnit =
      typeof root[`${matchedKey}Unit`] === 'string'
        ? (root[`${matchedKey}Unit`] as string)
        : fieldDef.defaultUnit;

    const validated = buildValidatedSample({
      metricType: fieldDef.metricType,
      value: numericVal,
      unit: explicitUnit,
      recordedAt: rootTimestamp,
      context: rootContext,
      source: rootSource,
      deviceModel: rootDevice,
    });
    if (validated) samples.push(validated);
    else ignoredFields.push(matchedKey);
  }

  return {
    patientId: rootPatientId,
    idempotencyKey,
    source: rootSource,
    evaluate,
    samples,
    ignoredFields,
  };
}
