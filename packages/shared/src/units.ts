import type { MetricType } from './schemas.ts';

export const CANONICAL_UNITS: Record<MetricType, string> = {
  heart_rate: 'bpm',
  resting_heart_rate: 'bpm',
  hrv_rmssd: 'ms',
  spo2: '%',
  respiratory_rate: 'breaths/min',
  skin_temp_deviation: 'degC',
  body_temperature: 'degC',
  steps: 'count',
  sleep_duration_min: 'min',
  sleep_efficiency: '%',
  sleep_awakenings: 'count',
  systolic_bp: 'mmHg',
  blood_glucose: 'mg/dL',
  weight_kg: 'kg',
  afib_burden: '%',
};

export const PHYSICAL_BOUNDS: Record<MetricType, { min: number; max: number }> = {
  heart_rate: { min: 20, max: 250 },
  resting_heart_rate: { min: 25, max: 200 },
  hrv_rmssd: { min: 1, max: 350 },
  spo2: { min: 50, max: 100 },
  respiratory_rate: { min: 4, max: 60 },
  skin_temp_deviation: { min: -6, max: 6 },
  body_temperature: { min: 30, max: 43 },
  steps: { min: 0, max: 100000 },
  sleep_duration_min: { min: 0, max: 1440 },
  sleep_efficiency: { min: 0, max: 100 },
  sleep_awakenings: { min: 0, max: 100 },
  systolic_bp: { min: 50, max: 280 },
  blood_glucose: { min: 20, max: 700 },
  weight_kg: { min: 20, max: 300 },
  afib_burden: { min: 0, max: 100 },
};

export interface NormalizedUnitResult {
  value: number;
  unit: string;
  converted: boolean;
}

/**
 * Normalizes vendor/export units into SENTINEL canonical SI/clinical units.
 * Mirrors HealthKit 0..1 percentage fraction handling verified in open-wearables.
 */
export function normalizeToCanonicalUnit(
  metricType: MetricType,
  rawValue: number,
  rawUnit: string,
): NormalizedUnitResult {
  const canonical = CANONICAL_UNITS[metricType];
  const u = rawUnit.trim().toLowerCase();

  if (metricType === 'body_temperature' || metricType === 'skin_temp_deviation') {
    if (u === 'degf' || u === '°f' || u === 'f') {
      const convertedVal =
        metricType === 'skin_temp_deviation' ? rawValue * (5 / 9) : (rawValue - 32) * (5 / 9);
      return { value: Number(convertedVal.toFixed(3)), unit: canonical, converted: true };
    }
    return { value: rawValue, unit: canonical, converted: u !== 'degc' };
  }

  if (metricType === 'spo2' || metricType === 'sleep_efficiency' || metricType === 'afib_burden') {
    // Apple Health XML often emits oxygen saturation as 0..1 fraction while unit="%"
    if (rawValue > 0 && rawValue <= 1.0 && (u === '%' || u === 'fraction' || u === 'ratio')) {
      return { value: Number((rawValue * 100).toFixed(2)), unit: canonical, converted: true };
    }
    return { value: rawValue, unit: canonical, converted: false };
  }

  if (metricType === 'weight_kg' && (u === 'lb' || u === 'lbs')) {
    return { value: Number((rawValue * 0.45359237).toFixed(2)), unit: canonical, converted: true };
  }

  if (metricType === 'blood_glucose' && u === 'mmol/l') {
    return { value: Number((rawValue * 18.0182).toFixed(1)), unit: canonical, converted: true };
  }

  if (metricType === 'sleep_duration_min') {
    if (u === 's' || u === 'sec' || u === 'seconds') {
      return { value: Number((rawValue / 60).toFixed(1)), unit: canonical, converted: true };
    }
    if (u === 'h' || u === 'hr' || u === 'hours') {
      return { value: Number((rawValue * 60).toFixed(1)), unit: canonical, converted: true };
    }
  }

  return { value: rawValue, unit: canonical, converted: u !== canonical.toLowerCase() };
}

export function isWithinPhysicalBounds(metricType: MetricType, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const bounds = PHYSICAL_BOUNDS[metricType];
  return value >= bounds.min && value <= bounds.max;
}
