import {
  ActivityContextSchema,
  MetricTypeSchema,
  type MetricType,
  type VitalSampleInput,
} from '@sentinel/shared';

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

  if (tsIdx === -1 || valIdx === -1) {
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

/**
 * Parses Google / Fitbit Takeout JSON exports (`heart_rate`, `resting_heart_rate`,
 * `spo2`, `sleep`, `steps`, or Health Connect JSON bundles).
 */
export function parseTakeoutJson(rawJsonText: string): {
  samples: VitalSampleInput[];
  skipped: number;
} {
  const parsed = JSON.parse(rawJsonText) as unknown;
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

    // Pattern 3: Google Takeout generic record { metricType, value, unit, recordedAt }
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
