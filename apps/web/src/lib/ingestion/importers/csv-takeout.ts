import {
  ActivityContextSchema,
  MetricTypeSchema,
  type MetricType,
  type VitalSampleInput,
} from '@sentinel/shared';
import { normalizeWatchPayload } from '../watch-normalizer';

export interface CsvMappingConfig {
  timestampColumn: string;
  valueColumn: string;
  metricColumn?: string;
  fixedMetricType?: MetricType;
  unitColumn?: string;
  fixedUnit?: string;
  contextColumn?: string;
}

export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

const WIDE_CSV_COLUMN_MAP: ReadonlyArray<{
  headerPatterns: readonly RegExp[];
  metricType: MetricType;
  unit: string;
  context: VitalSampleInput['context'];
}> = [
  {
    headerPatterns: [/^average heart rate/i, /^avg heart rate/i, /^heart rate/i],
    metricType: 'heart_rate',
    unit: 'bpm',
    context: 'unknown',
  },
  {
    headerPatterns: [/^min heart rate/i, /^resting heart rate/i],
    metricType: 'resting_heart_rate',
    unit: 'bpm',
    context: 'rest',
  },
  {
    headerPatterns: [/^step count/i, /^steps$/i],
    metricType: 'steps',
    unit: 'count',
    context: 'light_activity',
  },
  {
    headerPatterns: [/^oxygen saturation/i, /^spo2/i],
    metricType: 'spo2',
    unit: '%',
    context: 'rest',
  },
  {
    headerPatterns: [/^respiratory rate/i, /^breathing rate/i],
    metricType: 'respiratory_rate',
    unit: 'breaths/min',
    context: 'rest',
  },
  {
    headerPatterns: [/^weight/i],
    metricType: 'weight_kg',
    unit: 'kg',
    context: 'rest',
  },
];

function parseWidePhoneCsv(
  lines: string[],
  headers: string[],
): { samples: VitalSampleInput[]; skipped: number } | null {
  const dateIdx = headers.findIndex((h) => /^(date|timestamp|time|start time)$/i.test(h));
  if (dateIdx === -1) return null;

  const matchedColumns: Array<{
    idx: number;
    metricType: MetricType;
    unit: string;
    context: VitalSampleInput['context'];
  }> = [];

  for (let i = 0; i < headers.length; i += 1) {
    if (i === dateIdx) continue;
    const h = headers[i]!;
    for (const def of WIDE_CSV_COLUMN_MAP) {
      if (def.headerPatterns.some((re) => re.test(h))) {
        matchedColumns.push({
          idx: i,
          metricType: def.metricType,
          unit: def.unit,
          context: def.context,
        });
        break;
      }
    }
  }

  if (matchedColumns.length === 0) return null;

  const samples: VitalSampleInput[] = [];
  let skipped = 0;

  for (let r = 1; r < lines.length; r += 1) {
    const cols = splitCsvLine(lines[r]!);
    const rawTs = cols[dateIdx];
    const dt = rawTs ? new Date(rawTs) : null;
    if (!dt || Number.isNaN(dt.getTime())) {
      skipped += 1;
      continue;
    }

    for (const colDef of matchedColumns) {
      const rawCell = cols[colDef.idx];
      if (!rawCell) continue;
      const val = Number(rawCell);
      if (!Number.isFinite(val)) {
        skipped += 1;
        continue;
      }
      samples.push({
        metricType: colDef.metricType,
        value: val,
        unit: colDef.unit,
        recordedAt: dt.toISOString(),
        context: colDef.context,
        source: 'google_takeout',
        deviceModel: 'Google Fit CSV',
        isSynthetic: false,
      });
    }
  }

  return { samples, skipped };
}

export function parseCsvWithMapper(
  csvText: string,
  mapping: CsvMappingConfig,
): { samples: VitalSampleInput[]; skipped: number } {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { samples: [], skipped: 0 };

  const headers = splitCsvLine(lines[0]!);
  const idx = (col?: string) => (col ? headers.indexOf(col) : -1);

  const tsIdx = idx(mapping.timestampColumn);
  const valIdx = idx(mapping.valueColumn);
  const metricIdx = idx(mapping.metricColumn);
  const unitIdx = idx(mapping.unitColumn);
  const ctxIdx = idx(mapping.contextColumn);

  // Auto-detect wide phone app CSV exports (such as Google Fit Daily activity metrics.csv)
  if (tsIdx === -1 || valIdx === -1) {
    const wideRes = parseWidePhoneCsv(lines, headers);
    if (wideRes) return wideRes;
    throw new Error('Timestamp or value column not found in CSV header');
  }

  const samples: VitalSampleInput[] = [];
  let skipped = 0;

  for (let r = 1; r < lines.length; r += 1) {
    const cols = splitCsvLine(lines[r]!);
    const rawTs = cols[tsIdx];
    const rawVal = Number(cols[valIdx]);
    const dt = rawTs ? new Date(rawTs) : null;
    if (!dt || Number.isNaN(dt.getTime()) || !Number.isFinite(rawVal)) {
      skipped += 1;
      continue;
    }

    const rawMetric = metricIdx >= 0 ? cols[metricIdx] : mapping.fixedMetricType;
    const metricParsed = MetricTypeSchema.safeParse(rawMetric);
    if (!metricParsed.success) {
      skipped += 1;
      continue;
    }

    const rawCtx = ctxIdx >= 0 ? cols[ctxIdx] : 'unknown';
    const ctxParsed = ActivityContextSchema.safeParse(rawCtx);

    samples.push({
      metricType: metricParsed.data,
      value: rawVal,
      unit: (unitIdx >= 0 ? cols[unitIdx] : mapping.fixedUnit) || 'bpm',
      recordedAt: dt.toISOString(),
      context: ctxParsed.success ? ctxParsed.data : 'unknown',
      source: 'csv_import',
      isSynthetic: false,
    });
  }

  return { samples, skipped };
}

function nanosToIso(rawNanos: unknown): string | null {
  if (typeof rawNanos === 'number' && Number.isFinite(rawNanos)) {
    const d = new Date(Math.floor(rawNanos / 1_000_000));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof rawNanos === 'string' && /^\d+$/.test(rawNanos.trim())) {
    const ms = Number(BigInt(rawNanos.trim()) / BigInt(1_000_000));
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

function googleFitDataTypeToMetric(dataType: string): {
  metricType: MetricType;
  unit: string;
  context: VitalSampleInput['context'];
} | null {
  const dt = dataType.toLowerCase();
  if (dt.includes('heart_rate.bpm')) return { metricType: 'heart_rate', unit: 'bpm', context: 'unknown' };
  if (dt.includes('resting_heart_rate')) {
    return { metricType: 'resting_heart_rate', unit: 'bpm', context: 'rest' };
  }
  if (dt.includes('oxygen_saturation')) return { metricType: 'spo2', unit: '%', context: 'rest' };
  if (dt.includes('respiratory_rate')) {
    return { metricType: 'respiratory_rate', unit: 'breaths/min', context: 'rest' };
  }
  if (dt.includes('step_count')) return { metricType: 'steps', unit: 'count', context: 'light_activity' };
  if (dt.includes('body.temperature')) {
    return { metricType: 'body_temperature', unit: 'degC', context: 'rest' };
  }
  if (dt.includes('blood_pressure')) return { metricType: 'systolic_bp', unit: 'mmHg', context: 'rest' };
  if (dt.includes('blood_glucose')) return { metricType: 'blood_glucose', unit: 'mg/dL', context: 'rest' };
  if (dt.includes('weight')) return { metricType: 'weight_kg', unit: 'kg', context: 'rest' };
  return null;
}

/**
 * Parses Google Fit Takeout JSON (`Data Points`), Android Health Connect / Health Sync JSON,
 * Fitbit Takeout JSON, Apple Health Auto Export JSON, or canonical JSON records.
 */
export function parseTakeoutJson(rawJsonText: string): {
  samples: VitalSampleInput[];
  skipped: number;
} {
  const parsed = JSON.parse(rawJsonText) as unknown;

  // Pattern A: Google Fit Takeout JSON { "Data Source": "...", "Data Points": [...] }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    Array.isArray((parsed as Record<string, unknown>)['Data Points'])
  ) {
    const rootObj = parsed as Record<string, unknown>;
    const topDataSource = typeof rootObj['Data Source'] === 'string' ? rootObj['Data Source'] : '';
    const points = rootObj['Data Points'] as unknown[];
    const samples: VitalSampleInput[] = [];
    let skipped = 0;

    for (const pt of points) {
      if (typeof pt !== 'object' || pt === null) {
        skipped += 1;
        continue;
      }
      const p = pt as Record<string, unknown>;
      const dataType =
        typeof p.dataTypeName === 'string' ? p.dataTypeName : topDataSource;
      const recordedAt =
        nanosToIso(p.endTimeNanos ?? p.startTimeNanos) ??
        (typeof p.modifiedTimeMillis === 'number'
          ? new Date(p.modifiedTimeMillis).toISOString()
          : null);

      if (!recordedAt) {
        skipped += 1;
        continue;
      }

      if (dataType.toLowerCase().includes('sleep.segment')) {
        const sMs = nanosToIso(p.startTimeNanos);
        const eMs = nanosToIso(p.endTimeNanos);
        if (sMs && eMs) {
          const mins = Math.round((new Date(eMs).getTime() - new Date(sMs).getTime()) / 60_000);
          if (mins > 0 && mins <= 1440) {
            samples.push({
              metricType: 'sleep_duration_min',
              value: mins,
              unit: 'min',
              recordedAt: eMs,
              context: 'sleep',
              source: 'google_takeout',
              deviceModel: 'Google Fit',
              isSynthetic: false,
            });
            continue;
          }
        }
      }

      const mapped = googleFitDataTypeToMetric(dataType);
      const fitValues = Array.isArray(p.fitValue) ? p.fitValue : [];
      const firstFit = fitValues[0] as { value?: { fpVal?: number; intVal?: number } } | undefined;
      const numVal = firstFit?.value?.fpVal ?? firstFit?.value?.intVal;
      if (!mapped || typeof numVal !== 'number' || !Number.isFinite(numVal)) {
        skipped += 1;
        continue;
      }

      samples.push({
        metricType: mapped.metricType,
        value: numVal,
        unit: mapped.unit,
        recordedAt,
        context: mapped.context,
        source: 'google_takeout',
        deviceModel: 'Google Fit',
        isSynthetic: false,
      });
    }

    return { samples, skipped };
  }

  // Pattern B: Apple Health Auto Export JSON ({ data: { metrics: [...] } })
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    typeof (parsed as { data?: unknown }).data === 'object'
  ) {
    const normalized = normalizeWatchPayload(parsed);
    if (normalized.samples.length > 0) {
      return { samples: normalized.samples, skipped: normalized.ignoredFields.length };
    }
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { records?: unknown[] }).records)
      ? (parsed as { records: unknown[] }).records
      : [];

  const samples: VitalSampleInput[] = [];
  let skipped = 0;

  for (const item of rows) {
    if (typeof item !== 'object' || item === null) {
      skipped += 1;
      continue;
    }
    const obj = item as Record<string, unknown>;

    // Pattern 1: Fitbit Takeout heart_rate-*.json { dateTime, value: { bpm } }
    if (typeof obj.dateTime === 'string' && typeof obj.value === 'object' && obj.value !== null) {
      const valObj = obj.value as Record<string, unknown>;
      const dt = new Date(obj.dateTime.replace(' ', 'T') + (obj.dateTime.includes('Z') ? '' : 'Z'));
      if (Number.isNaN(dt.getTime())) {
        skipped += 1;
        continue;
      }
      if (typeof valObj.bpm === 'number') {
        samples.push({
          metricType: 'heart_rate',
          value: valObj.bpm,
          unit: 'bpm',
          recordedAt: dt.toISOString(),
          context: 'unknown',
          source: 'fitbit_takeout',
          isSynthetic: false,
        });
        continue;
      }
      if (typeof valObj.value === 'number') {
        samples.push({
          metricType: 'resting_heart_rate',
          value: valObj.value,
          unit: 'bpm',
          recordedAt: dt.toISOString(),
          context: 'rest',
          source: 'fitbit_takeout',
          isSynthetic: false,
        });
        continue;
      }
    }

    // Pattern 2: Fitbit sleep-*.json { startTime, minutesAsleep, efficiency }
    if (typeof obj.startTime === 'string' && typeof obj.minutesAsleep === 'number') {
      const dt = new Date(obj.startTime);
      if (!Number.isNaN(dt.getTime())) {
        samples.push({
          metricType: 'sleep_duration_min',
          value: obj.minutesAsleep,
          unit: 'min',
          recordedAt: dt.toISOString(),
          context: 'sleep',
          source: 'fitbit_takeout',
          isSynthetic: false,
        });
        if (typeof obj.efficiency === 'number') {
          samples.push({
            metricType: 'sleep_efficiency',
            value: obj.efficiency,
            unit: '%',
            recordedAt: dt.toISOString(),
            context: 'sleep',
            source: 'fitbit_takeout',
            isSynthetic: false,
          });
        }
        continue;
      }
    }

    // Pattern 3: Android Health Connect HeartRateRecord { samples: [{ beatsPerMinute, time }] }
    if (Array.isArray(obj.samples)) {
      let added = false;
      for (const s of obj.samples) {
        if (typeof s !== 'object' || s === null) continue;
        const pt = s as Record<string, unknown>;
        const dt = typeof pt.time === 'string' ? new Date(pt.time) : null;
        if (typeof pt.beatsPerMinute === 'number' && dt && !Number.isNaN(dt.getTime())) {
          samples.push({
            metricType: 'heart_rate',
            value: pt.beatsPerMinute,
            unit: 'bpm',
            recordedAt: dt.toISOString(),
            context: 'unknown',
            source: 'google_takeout',
            deviceModel: 'Health Connect',
            isSynthetic: false,
          });
          added = true;
        }
      }
      if (added) continue;
    }

    // Pattern 4: Android Health Connect Steps / SpO2 / SleepSession record
    if (typeof obj.startTime === 'string' && typeof obj.endTime === 'string') {
      const sDt = new Date(obj.startTime);
      const eDt = new Date(obj.endTime);
      if (!Number.isNaN(sDt.getTime()) && !Number.isNaN(eDt.getTime())) {
        if (typeof obj.count === 'number') {
          samples.push({
            metricType: 'steps',
            value: obj.count,
            unit: 'count',
            recordedAt: eDt.toISOString(),
            context: 'light_activity',
            source: 'google_takeout',
            deviceModel: 'Health Connect',
            isSynthetic: false,
          });
          continue;
        }
        if (typeof obj.percentage === 'number') {
          samples.push({
            metricType: 'spo2',
            value: obj.percentage,
            unit: '%',
            recordedAt: eDt.toISOString(),
            context: 'rest',
            source: 'google_takeout',
            deviceModel: 'Health Connect',
            isSynthetic: false,
          });
          continue;
        }
        if (typeof obj.beatsPerMinute === 'number') {
          samples.push({
            metricType: 'resting_heart_rate',
            value: obj.beatsPerMinute,
            unit: 'bpm',
            recordedAt: eDt.toISOString(),
            context: 'rest',
            source: 'google_takeout',
            deviceModel: 'Health Connect',
            isSynthetic: false,
          });
          continue;
        }
        if (typeof obj.title === 'string' || typeof obj.notes === 'string' || obj.stages !== undefined) {
          const mins = Math.round((eDt.getTime() - sDt.getTime()) / 60_000);
          if (mins > 0 && mins <= 1440) {
            samples.push({
              metricType: 'sleep_duration_min',
              value: mins,
              unit: 'min',
              recordedAt: eDt.toISOString(),
              context: 'sleep',
              source: 'google_takeout',
              deviceModel: 'Health Connect',
              isSynthetic: false,
            });
            continue;
          }
        }
      }
    }

    // Pattern 5: Google Takeout generic record { metricType, value, unit, recordedAt }
    const mCheck = MetricTypeSchema.safeParse(obj.metricType);
    if (mCheck.success && typeof obj.value === 'number' && typeof obj.recordedAt === 'string') {
      const dt = new Date(obj.recordedAt);
      if (!Number.isNaN(dt.getTime())) {
        samples.push({
          metricType: mCheck.data,
          value: obj.value,
          unit: typeof obj.unit === 'string' ? obj.unit : 'bpm',
          recordedAt: dt.toISOString(),
          context: 'unknown',
          source: 'google_takeout',
          isSynthetic: false,
        });
        continue;
      }
    }

    skipped += 1;
  }

  return { samples, skipped };
}
