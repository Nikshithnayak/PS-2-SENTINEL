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

export interface BlePulseOximeterReading {
  spo2: number | null;
  pulseRate: number | null;
}

const IEEE_11073_SFLOAT_SPECIAL = new Set([0x07ff, 0x0800, 0x07fe, 0x0802, 0x0801]);

/**
 * Decodes an unsigned 16-bit IEEE-11073 SFLOAT (4-bit signed exponent + 12-bit signed mantissa).
 * Returns null for NaN / NRes / Inf / Reserved sentinel values.
 */
export function decodeIeee11073Sfloat(raw16: number): number | null {
  if (IEEE_11073_SFLOAT_SPECIAL.has(raw16)) return null;
  let mantissa = raw16 & 0x0fff;
  if ((mantissa & 0x0800) !== 0) mantissa -= 0x1000;
  let exponent = (raw16 >> 12) & 0x0f;
  if ((exponent & 0x08) !== 0) exponent -= 16;
  const val = mantissa * Math.pow(10, exponent);
  return Number.isFinite(val) ? Number(val.toFixed(2)) : null;
}

/**
 * Parses a Bluetooth SIG Pulse Oximeter Service (0x1822) PLX Spot-Check (0x2A5E)
 * or PLX Continuous Measurement (0x2A5F) packet for SpO2 (%) and Pulse Rate (bpm).
 */
export function parseBlePulseOximeterMeasurement(view: DataView): BlePulseOximeterReading {
  if (view.byteLength < 5) {
    throw new Error('Malformed BLE 0x1822 PLX packet: expected at least 5 bytes');
  }
  const rawSpo2 = decodeIeee11073Sfloat(view.getUint16(1, true));
  const rawPr = decodeIeee11073Sfloat(view.getUint16(3, true));
  return {
    spo2: rawSpo2 !== null && rawSpo2 >= 50 && rawSpo2 <= 100 ? rawSpo2 : null,
    pulseRate: rawPr !== null && rawPr >= 20 && rawPr <= 250 ? Math.round(rawPr) : null,
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

function readNestedNumber(
  raw: unknown,
  nestedKeys: readonly string[] = ['value', 'inCelsius', 'inFahrenheit', 'inMillimetersOfMercury', 'inKilograms', 'inMilligramsPerDeciliter'],
): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim().length > 0 && Number.isFinite(Number(raw))) {
    return Number(raw);
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.inMillimolesPerLiter === 'number' && Number.isFinite(obj.inMillimolesPerLiter)) {
      return Number((obj.inMillimolesPerLiter * 18.0182).toFixed(1));
    }
    for (const k of nestedKeys) {
      if (typeof obj[k] === 'number' && Number.isFinite(obj[k] as number)) {
        return obj[k] as number;
      }
    }
  }
  return null;
}

const HC_ARRAY_GROUPS: ReadonlyArray<{
  keys: readonly string[];
  kind:
    | 'heart_rate'
    | 'resting_heart_rate'
    | 'hrv_rmssd'
    | 'spo2'
    | 'respiratory_rate'
    | 'body_temperature'
    | 'steps'
    | 'sleep_sessions'
    | 'blood_pressure'
    | 'blood_glucose'
    | 'weight_kg';
}> = [
  { keys: ['heart_rate', 'heartRate', 'HeartRate', 'HeartRateRecord'], kind: 'heart_rate' },
  {
    keys: ['resting_heart_rate', 'restingHeartRate', 'RestingHeartRate', 'RestingHeartRateRecord'],
    kind: 'resting_heart_rate',
  },
  {
    keys: [
      'heart_rate_variability_rmssd',
      'heartRateVariabilityRmssd',
      'HeartRateVariabilityRmssd',
      'HeartRateVariabilityRmssdRecord',
    ],
    kind: 'hrv_rmssd',
  },
  {
    keys: ['oxygen_saturation', 'oxygenSaturation', 'OxygenSaturation', 'OxygenSaturationRecord'],
    kind: 'spo2',
  },
  {
    keys: ['respiratory_rate', 'respiratoryRate', 'RespiratoryRate', 'RespiratoryRateRecord'],
    kind: 'respiratory_rate',
  },
  {
    keys: ['body_temperature', 'bodyTemperature', 'BodyTemperature', 'BodyTemperatureRecord'],
    kind: 'body_temperature',
  },
  { keys: ['steps', 'Steps', 'StepsRecord'], kind: 'steps' },
  {
    keys: ['sleep_sessions', 'sleepSessions', 'SleepSession', 'SleepSessionRecord', 'sleep'],
    kind: 'sleep_sessions',
  },
  {
    keys: ['blood_pressure', 'bloodPressure', 'BloodPressure', 'BloodPressureRecord'],
    kind: 'blood_pressure',
  },
  {
    keys: ['blood_glucose', 'bloodGlucose', 'BloodGlucose', 'BloodGlucoseRecord'],
    kind: 'blood_glucose',
  },
  { keys: ['weight', 'Weight', 'WeightRecord'], kind: 'weight_kg' },
];

/**
 * Extracts Android Health Connect records pushed directly from background companion apps
 * such as HC Webhook (`mcnaveen/health-connect-webhook`) or Tasker/HTTP Shortcuts.
 */
function extractHealthConnectWebhookSamples(
  container: Record<string, unknown>,
  rootTimestamp: string,
  rootContext: ActivityContext,
  source: ProviderSource,
  rootDevice: string | undefined,
): { matchedHealthConnect: boolean; samples: VitalSampleInput[]; ignored: string[] } {
  const samples: VitalSampleInput[] = [];
  const ignored: string[] = [];
  let matchedHealthConnect = false;

  for (const group of HC_ARRAY_GROUPS) {
    let matchedKey: string | undefined;
    let records: unknown[] | undefined;
    for (const k of group.keys) {
      if (Array.isArray(container[k])) {
        matchedKey = k;
        records = container[k] as unknown[];
        break;
      }
    }
    if (!matchedKey || !records) continue;
    matchedHealthConnect = true;

    for (const rawRec of records) {
      if (!rawRec || typeof rawRec !== 'object') continue;
      const rec = rawRec as Record<string, unknown>;
      const meta =
        rec.metadata && typeof rec.metadata === 'object'
          ? (rec.metadata as Record<string, unknown>)
          : undefined;
      const recDevice =
        (typeof meta?.dataOrigin === 'string' && meta.dataOrigin) ||
        (typeof rec.deviceModel === 'string' && rec.deviceModel) ||
        rootDevice ||
        'Android Health Connect';
      const externalId = typeof meta?.id === 'string' ? meta.id : undefined;

      if (group.kind === 'heart_rate') {
        const innerSamples = Array.isArray(rec.samples) ? rec.samples : [rec];
        for (const s of innerSamples) {
          if (!s || typeof s !== 'object') continue;
          const pt = s as Record<string, unknown>;
          const bpm = readNestedNumber(pt.beatsPerMinute ?? pt.bpm ?? pt.value);
          if (bpm === null) {
            ignored.push(matchedKey);
            continue;
          }
          const validated = buildValidatedSample({
            metricType: 'heart_rate',
            value: bpm,
            unit: 'bpm',
            recordedAt: toOffsetIso(pt.time ?? rec.startTime ?? rec.endTime, rootTimestamp),
            context: rootContext === 'unknown' ? 'rest' : rootContext,
            source,
            deviceModel: recDevice,
            externalId,
          });
          if (validated) samples.push(validated);
        }
        continue;
      }

      if (group.kind === 'sleep_sessions') {
        const startStr = typeof rec.startTime === 'string' ? rec.startTime : undefined;
        const endStr = typeof rec.endTime === 'string' ? rec.endTime : undefined;
        let minutes = readNestedNumber(rec.durationMinutes ?? rec.minutesAsleep ?? rec.value);
        if (minutes === null && startStr && endStr) {
          const stages = Array.isArray(rec.stages) ? rec.stages : [];
          if (stages.length > 0) {
            let asleepMs = 0;
            for (const st of stages) {
              if (!st || typeof st !== 'object') continue;
              const stageObj = st as Record<string, unknown>;
              const stName = String(stageObj.stage ?? '').toLowerCase();
              if (stName === 'awake' || stName === 'out_of_bed') continue;
              const sMs = Date.parse(String(stageObj.startTime ?? ''));
              const eMs = Date.parse(String(stageObj.endTime ?? ''));
              if (Number.isFinite(sMs) && Number.isFinite(eMs) && eMs > sMs) {
                asleepMs += eMs - sMs;
              }
            }
            if (asleepMs > 0) minutes = Math.round(asleepMs / 60_000);
          }
          if (minutes === null) {
            const sMs = Date.parse(startStr);
            const eMs = Date.parse(endStr);
            if (Number.isFinite(sMs) && Number.isFinite(eMs) && eMs > sMs) {
              minutes = Math.round((eMs - sMs) / 60_000);
            }
          }
        }
        if (minutes !== null && minutes > 0) {
          const validated = buildValidatedSample({
            metricType: 'sleep_duration_min',
            value: Math.min(1440, minutes),
            unit: 'min',
            recordedAt: toOffsetIso(endStr ?? startStr ?? rec.time, rootTimestamp),
            context: 'sleep',
            source,
            deviceModel: recDevice,
            externalId,
          });
          if (validated) samples.push(validated);
        } else {
          ignored.push(matchedKey);
        }
        continue;
      }

      const spec: { metric: MetricType; unit: string; val: number | null; ctx: ActivityContext } =
        group.kind === 'resting_heart_rate'
          ? {
              metric: 'resting_heart_rate',
              unit: 'bpm',
              val: readNestedNumber(rec.beatsPerMinute ?? rec.bpm ?? rec.value),
              ctx: 'sleep',
            }
          : group.kind === 'hrv_rmssd'
            ? {
                metric: 'hrv_rmssd',
                unit: 'ms',
                val: readNestedNumber(rec.heartRateVariabilityMillis ?? rec.rmssd ?? rec.value),
                ctx: 'sleep',
              }
            : group.kind === 'spo2'
              ? {
                  metric: 'spo2',
                  unit: '%',
                  val: readNestedNumber(rec.percentage ?? rec.spo2 ?? rec.value),
                  ctx: 'rest',
                }
              : group.kind === 'respiratory_rate'
                ? {
                    metric: 'respiratory_rate',
                    unit: 'breaths/min',
                    val: readNestedNumber(rec.rate ?? rec.value),
                    ctx: 'rest',
                  }
                : group.kind === 'body_temperature'
                  ? {
                      metric: 'body_temperature',
                      unit: 'degC',
                      val: readNestedNumber(rec.temperature ?? rec.value),
                      ctx: rootContext,
                    }
                  : group.kind === 'steps'
                    ? {
                        metric: 'steps',
                        unit: 'count',
                        val: readNestedNumber(rec.count ?? rec.steps ?? rec.value),
                        ctx: 'light_activity',
                      }
                    : group.kind === 'blood_pressure'
                      ? {
                          metric: 'systolic_bp',
                          unit: 'mmHg',
                          val: readNestedNumber(rec.systolic ?? rec.value),
                          ctx: 'rest',
                        }
                      : group.kind === 'blood_glucose'
                        ? {
                            metric: 'blood_glucose',
                            unit: 'mg/dL',
                            val: readNestedNumber(rec.level ?? rec.glucose ?? rec.value),
                            ctx: rootContext,
                          }
                        : {
                            metric: 'weight_kg',
                            unit: 'kg',
                            val: readNestedNumber(rec.weight ?? rec.value),
                            ctx: rootContext,
                          };

      if (spec.val === null) {
        ignored.push(matchedKey);
        continue;
      }

      const validated = buildValidatedSample({
        metricType: spec.metric,
        value: spec.val,
        unit: typeof rec.unit === 'string' && rec.unit.trim() ? rec.unit.trim() : spec.unit,
        recordedAt: toOffsetIso(rec.time ?? rec.endTime ?? rec.startTime, rootTimestamp),
        context: rootContext === 'unknown' ? spec.ctx : rootContext,
        source,
        deviceModel: recDevice,
        externalId,
      });
      if (validated) samples.push(validated);
      else ignored.push(matchedKey);
    }
  }

  return { matchedHealthConnect, samples, ignored };
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

  // 2.5 Android Health Connect companion webhook shapes (HC Webhook / HealthConnectWebhook)
  const hasExplicitSource = typeof root.source === 'string' && root.source.trim().length > 0;
  const hcSource: ProviderSource = hasExplicitSource ? rootSource : 'health_connect';
  const hcRoot = extractHealthConnectWebhookSamples(
    root,
    rootTimestamp,
    rootContext,
    hcSource,
    rootDevice,
  );
  const hcNested =
    dataObj && !Array.isArray(dataObj.metrics)
      ? extractHealthConnectWebhookSamples(dataObj, rootTimestamp, rootContext, hcSource, rootDevice)
      : { matchedHealthConnect: false, samples: [], ignored: [] };

  samples.push(...hcRoot.samples, ...hcNested.samples);
  ignoredFields.push(...hcRoot.ignored, ...hcNested.ignored);
  const resolvedSource: ProviderSource =
    !hasExplicitSource && (hcRoot.matchedHealthConnect || hcNested.matchedHealthConnect)
      ? 'health_connect'
      : rootSource;

  // 3. Flat smartwatch JSON snapshot ({ heartRate, spo2, steps, sleepMinutes, ... })
  for (const fieldDef of FLAT_FIELD_TO_METRIC) {
    let rawValue: unknown;
    let matchedKey: string | undefined;
    for (const k of fieldDef.keys) {
      if (
        root[k] !== undefined &&
        root[k] !== null &&
        root[k] !== '' &&
        typeof root[k] !== 'object'
      ) {
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
    source: resolvedSource,
    evaluate,
    samples,
    ignoredFields,
  };
}
