import { normalizeToCanonicalUnit, type MetricType, type VitalSampleInput } from '@sentinel/shared';

export interface AppleXmlParseResult {
  samples: VitalSampleInput[];
  stats: {
    recordsScanned: number;
    accepted: number;
    skipped: number;
    skipReasons: Record<string, number>;
  };
}

const HK_TYPE_MAP: Record<string, { metricType: MetricType; defaultContext: VitalSampleInput['context'] }> = {
  HKQuantityTypeIdentifierHeartRate: { metricType: 'heart_rate', defaultContext: 'unknown' },
  HKQuantityTypeIdentifierRestingHeartRate: { metricType: 'resting_heart_rate', defaultContext: 'rest' },
  HKQuantityTypeIdentifierHeartRateVariabilitySDNN: { metricType: 'hrv_rmssd', defaultContext: 'sleep' },
  HKQuantityTypeIdentifierOxygenSaturation: { metricType: 'spo2', defaultContext: 'rest' },
  HKQuantityTypeIdentifierRespiratoryRate: { metricType: 'respiratory_rate', defaultContext: 'sleep' },
  HKQuantityTypeIdentifierAppleSleepingWristTemperature: {
    metricType: 'skin_temp_deviation',
    defaultContext: 'sleep',
  },
  HKQuantityTypeIdentifierBodyTemperature: { metricType: 'body_temperature', defaultContext: 'rest' },
  HKQuantityTypeIdentifierStepCount: { metricType: 'steps', defaultContext: 'light_activity' },
  HKQuantityTypeIdentifierBodyMass: { metricType: 'weight_kg', defaultContext: 'rest' },
  HKQuantityTypeIdentifierBloodGlucose: { metricType: 'blood_glucose', defaultContext: 'rest' },
  HKQuantityTypeIdentifierBloodPressureSystolic: { metricType: 'systolic_bp', defaultContext: 'rest' },
};

function extractAttr(tag: string, attrName: string): string | null {
  const regex = new RegExp(`${attrName}="([^"]*)"`, 'i');
  const m = tag.match(regex);
  return m?.[1] ?? null;
}

function parseAppleDate(raw: string): Date | null {
  // Apple Health format: "2026-11-20 06:30:00 +0530"
  const isoLike = raw.trim().replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+([+-]\d{4})$/, '$1T$2$3');
  const d = new Date(isoLike);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Streaming line/tag parser for Apple Health `export.xml`.
 * Processes arbitrary chunk sizes without loading a full XML DOM into memory.
 */
export async function parseAppleHealthXmlStream(
  chunks: AsyncIterable<string | Uint8Array>,
  maxSamples = 50000,
): Promise<AppleXmlParseResult> {
  const decoder = new TextDecoder();
  let carry = '';
  let recordsScanned = 0;
  let skipped = 0;
  const skipReasons: Record<string, number> = {};
  const samples: VitalSampleInput[] = [];

  const bumpSkip = (reason: string) => {
    skipped += 1;
    skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
  };

  const processRecordTag = (tag: string) => {
    recordsScanned += 1;
    const hkType = extractAttr(tag, 'type');
    if (!hkType) {
      bumpSkip('missing_type');
      return;
    }

    if (hkType === 'HKCategoryTypeIdentifierSleepAnalysis') {
      const val = extractAttr(tag, 'value') ?? '';
      if (!val.includes('Asleep')) {
        return;
      }
      const startRaw = extractAttr(tag, 'startDate');
      const endRaw = extractAttr(tag, 'endDate');
      const start = startRaw ? parseAppleDate(startRaw) : null;
      const end = endRaw ? parseAppleDate(endRaw) : null;
      if (!start || !end || end <= start) {
        bumpSkip('invalid_sleep_dates');
        return;
      }
      const durationMin = Number(((end.getTime() - start.getTime()) / 60_000).toFixed(1));
      if (samples.length < maxSamples) {
        samples.push({
          metricType: 'sleep_duration_min',
          value: durationMin,
          unit: 'min',
          recordedAt: start.toISOString(),
          windowSeconds: Math.round((end.getTime() - start.getTime()) / 1000),
          context: 'sleep',
          source: 'apple_health_xml',
          deviceModel: extractAttr(tag, 'sourceName') ?? 'Apple Watch',
          isSynthetic: false,
        });
      }
      return;
    }

    const mapping = HK_TYPE_MAP[hkType];
    if (!mapping) {
      return; // Unsupported HealthKit category (normal)
    }

    const rawValStr = extractAttr(tag, 'value');
    const rawVal = rawValStr ? Number(rawValStr) : Number.NaN;
    if (!Number.isFinite(rawVal)) {
      bumpSkip(`invalid_value:${mapping.metricType}`);
      return;
    }

    const startRaw = extractAttr(tag, 'startDate');
    const endRaw = extractAttr(tag, 'endDate');
    const start = startRaw ? parseAppleDate(startRaw) : null;
    if (!start) {
      bumpSkip(`invalid_date:${mapping.metricType}`);
      return;
    }
    const end = endRaw ? parseAppleDate(endRaw) : null;
    const windowSeconds =
      end && end > start ? Math.min(86400, Math.round((end.getTime() - start.getTime()) / 1000)) : 60;

    const unit = extractAttr(tag, 'unit') ?? '';
    const normalized = normalizeToCanonicalUnit(mapping.metricType, rawVal, unit || '%');

    if (samples.length < maxSamples) {
      samples.push({
        metricType: mapping.metricType,
        value: normalized.value,
        unit: normalized.unit,
        recordedAt: start.toISOString(),
        windowSeconds,
        context: mapping.defaultContext,
        source: 'apple_health_xml',
        deviceModel: extractAttr(tag, 'sourceName') ?? 'Apple Watch',
        isSynthetic: false,
      });
    }
  };

  for await (const chunk of chunks) {
    carry += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });

    let idx = 0;
    while (true) {
      const startTag = carry.indexOf('<Record ', idx);
      if (startTag === -1) {
        // Keep partial '<Record' prefix if split across chunk boundary
        const tailKeep = Math.max(idx, carry.length - 16);
        carry = carry.slice(tailKeep);
        break;
      }
      const endTag = carry.indexOf('>', startTag);
      if (endTag === -1) {
        carry = carry.slice(startTag);
        break;
      }
      processRecordTag(carry.slice(startTag, endTag + 1));
      idx = endTag + 1;
    }
  }

  return {
    samples,
    stats: {
      recordsScanned,
      accepted: samples.length,
      skipped,
      skipReasons,
    },
  };
}
