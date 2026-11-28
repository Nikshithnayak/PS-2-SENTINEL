import type { AlertLevel } from '@sentinel/shared';
import type { EngineEvaluationResult, SignalContribution } from './client';

export interface TsSampleInput {
  metricType: string;
  value: number;
  unit: string;
  recordedAt: string;
  context: string;
  dataConfidence: number;
  qualityFlags?: string[];
  isSynthetic: boolean;
}

export interface TsExclusionSpan {
  startsAt: string;
  endsAt: string;
  reason: string;
}

export interface TsEnvironmentInput {
  apparentTempC?: number | null;
  heatRiskLevel?: string | null;
  pm25?: number | null;
}

const DEFAULT_PRIORS: Record<string, [number, number]> = {
  resting_heart_rate: [66.0, 7.5],
  heart_rate: [76.0, 12.0],
  hrv_rmssd: [32.0, 11.0],
  spo2: [96.8, 1.4],
  respiratory_rate: [15.5, 2.0],
  skin_temp_deviation: [0.0, 0.35],
  body_temperature: [36.7, 0.35],
  steps: [320.0, 160.0],
  sleep_efficiency: [85.0, 6.0],
  sleep_duration_min: [420.0, 45.0],
  sleep_awakenings: [1.5, 1.0],
  systolic_bp: [126.0, 13.0],
  blood_glucose: [110.0, 22.0],
  weight_kg: [66.0, 5.0],
  afib_burden: [0.2, 1.0],
};

const MIN_SIGMA_FLOOR: Record<string, number> = {
  resting_heart_rate: 2.5,
  heart_rate: 4.5,
  hrv_rmssd: 4.0,
  spo2: 1.0,
  respiratory_rate: 1.0,
  skin_temp_deviation: 0.25,
  body_temperature: 0.22,
  steps: 65.0,
  sleep_efficiency: 4.0,
  sleep_duration_min: 30.0,
  sleep_awakenings: 1.0,
  systolic_bp: 6.5,
  blood_glucose: 15.0,
  weight_kg: 0.45,
  afib_burden: 1.5,
};

const RISK_DIRECTION: Record<string, number> = {
  resting_heart_rate: 1,
  heart_rate: 1,
  hrv_rmssd: -1,
  spo2: -1,
  respiratory_rate: 1,
  skin_temp_deviation: 1,
  body_temperature: 0,
  steps: -1,
  sleep_efficiency: -1,
  sleep_duration_min: -1,
  sleep_awakenings: 1,
  systolic_bp: 0,
  blood_glucose: 0,
  weight_kg: 1,
  afib_burden: 1,
};

const FRIENDLY_NAMES: Record<string, [string, string]> = {
  resting_heart_rate: ['Resting Heart Rate', 'bpm'],
  heart_rate: ['Heart Rate', 'bpm'],
  hrv_rmssd: ['Heart Rate Variability', 'ms'],
  spo2: ['Blood Oxygen (SpO2)', '%'],
  respiratory_rate: ['Breathing Rate', 'breaths/min'],
  skin_temp_deviation: ['Skin Temperature Shift', 'degC'],
  body_temperature: ['Body Temperature', 'degC'],
  steps: ['Hourly Activity', 'steps'],
  sleep_efficiency: ['Sleep Efficiency', '%'],
  sleep_duration_min: ['Sleep Duration', 'min'],
  sleep_awakenings: ['Night Awakenings', 'count'],
  systolic_bp: ['Systolic BP', 'mmHg'],
  blood_glucose: ['Blood Glucose', 'mg/dL'],
  weight_kg: ['Body Weight', 'kg'],
  afib_burden: ['Irregular Rhythm Share', '%'],
};

const MULTIVARIATE_METRICS = [
  'resting_heart_rate',
  'hrv_rmssd',
  'spo2',
  'respiratory_rate',
  'skin_temp_deviation',
  'steps',
] as const;

interface HourlyBucket {
  hourMs: number;
  hourIso: string;
  dayKey: string;
  circadianBlock: 'night' | 'morning' | 'afternoon' | 'evening';
  metrics: Record<string, number>;
  metricConfidences: Record<string, number>;
  contexts: Set<string>;
  meanConfidence: number;
  excluded: boolean;
}

function getCircadianBlock(hourUtc: number): 'night' | 'morning' | 'afternoon' | 'evening' {
  const localHour = Math.floor((hourUtc + 5.5) % 24);
  if (localHour >= 22 || localHour < 6) return 'night';
  if (localHour >= 6 && localHour < 12) return 'morning';
  if (localHour >= 12 && localHour < 18) return 'afternoon';
  return 'evening';
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function weightedMedian(values: number[], weights: number[]): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0]!;
  const pairs = values
    .map((v, i) => ({ v, w: Math.max(weights[i] ?? 1, 1e-6) }))
    .sort((a, b) => a.v - b.v);
  const totalW = pairs.reduce((acc, p) => acc + p.w, 0);
  let cum = 0;
  for (const p of pairs) {
    cum += p.w / totalW;
    if (cum >= 0.5) return p.v;
  }
  return pairs[pairs.length - 1]!.v;
}

function signedZ(
  metric: string,
  observed: number,
  expected: number,
  sigma: number,
): { rawZ: number; riskZ: number; dir: string } {
  const rawZ = (observed - expected) / Math.max(sigma, 1e-3);
  if (metric === 'hrv_rmssd') {
    if (rawZ <= 0) return { rawZ, riskZ: -rawZ, dir: 'lower' };
    return {
      rawZ,
      riskZ: Math.max(0, rawZ - 2.2),
      dir: rawZ > 2.8 ? 'erratic_high' : 'normal',
    };
  }
  const pol = RISK_DIRECTION[metric] ?? 0;
  if (pol === 1) {
    return { rawZ, riskZ: Math.max(0, rawZ), dir: rawZ > 0.8 ? 'higher' : rawZ < -1.0 ? 'lower' : 'normal' };
  }
  if (pol === -1) {
    return { rawZ, riskZ: Math.max(0, -rawZ), dir: rawZ < -0.8 ? 'lower' : rawZ > 1.0 ? 'higher' : 'normal' };
  }
  return { rawZ, riskZ: Math.abs(rawZ), dir: rawZ > 0.8 ? 'higher' : rawZ < -0.8 ? 'lower' : 'normal' };
}

function conditionWeights(conditions: string[]): {
  priors: Record<string, [number, number]>;
  weights: Record<string, number>;
  spo2Scale: 1 | 2;
} {
  const priors: Record<string, [number, number]> = { ...DEFAULT_PRIORS };
  const weights: Record<string, number> = {
    resting_heart_rate: 1.15,
    hrv_rmssd: 1.15,
    spo2: 1.25,
    respiratory_rate: 1.2,
    steps: 1.1,
    sleep_efficiency: 0.95,
    sleep_duration_min: 0.9,
  };
  let spo2Scale: 1 | 2 = 1;
  if (conditions.includes('copd')) {
    spo2Scale = 2;
    priors.spo2 = [90.5, 2.0];
    priors.respiratory_rate = [18.0, 2.2];
    weights.spo2 = 1.55;
    weights.respiratory_rate = 1.5;
  }
  if (conditions.includes('heart_failure')) {
    weights.resting_heart_rate = 1.35;
    weights.respiratory_rate = Math.max(weights.respiratory_rate ?? 1, 1.4);
    weights.weight_kg = 1.5;
  }
  if (conditions.includes('hypertension')) {
    weights.systolic_bp = 1.45;
  }
  if (conditions.includes('diabetes')) {
    weights.hrv_rmssd = Math.max(weights.hrv_rmssd ?? 1, 1.3);
    weights.blood_glucose = 1.35;
  }
  if (conditions.includes('arrhythmia')) {
    weights.afib_burden = 1.6;
    weights.resting_heart_rate = Math.max(weights.resting_heart_rate ?? 1, 1.45);
  }
  return { priors, weights, spo2Scale };
}

function buildPartialNews2Ts(latest: Record<string, number>, spo2Scale: 1 | 2, exercise: boolean) {
  const params: Array<{
    parameter: string;
    observedValue: number | null;
    points: number | null;
    status: string;
    rule: string;
  }> = [];

  let total = 0;
  let scored = 0;

  const rr = latest.respiratory_rate;
  if (rr !== undefined) {
    scored += 1;
    const pts = rr <= 8 || rr >= 25 ? 3 : rr >= 21 ? 2 : rr <= 11 ? 1 : 0;
    total += pts;
    params.push({
      parameter: 'respiratory_rate',
      observedValue: Number(rr.toFixed(1)),
      points: pts,
      status: 'scored',
      rule: 'NEWS2 RR scale',
    });
  } else {
    params.push({
      parameter: 'respiratory_rate',
      observedValue: null,
      points: null,
      status: 'unavailable_from_wearable',
      rule: 'Not reported in recent window',
    });
  }

  const spo2 = latest.spo2;
  if (spo2 !== undefined) {
    scored += 1;
    const pts =
      spo2Scale === 2
        ? spo2 <= 83
          ? 3
          : spo2 <= 85
            ? 2
            : spo2 <= 87
              ? 1
              : 0
        : spo2 <= 91
          ? 3
          : spo2 <= 93
            ? 2
            : spo2 <= 95
              ? 1
              : 0;
    total += pts;
    params.push({
      parameter: 'spo2',
      observedValue: Number(spo2.toFixed(1)),
      points: pts,
      status: 'scored',
      rule: `NEWS2 SpO2 Scale ${spo2Scale}`,
    });
  } else {
    params.push({
      parameter: 'spo2',
      observedValue: null,
      points: null,
      status: 'unavailable_from_wearable',
      rule: 'Not reported in recent window',
    });
  }

  const pulse = latest.resting_heart_rate ?? (!exercise ? latest.heart_rate : undefined);
  if (pulse !== undefined) {
    scored += 1;
    const pts = pulse <= 40 || pulse >= 131 ? 3 : pulse >= 111 ? 2 : pulse <= 50 || pulse >= 91 ? 1 : 0;
    total += pts;
    params.push({
      parameter: 'resting_pulse',
      observedValue: Number(pulse.toFixed(1)),
      points: pts,
      status: exercise ? 'exercise_context' : 'scored',
      rule: 'NEWS2 pulse scale',
    });
  } else {
    params.push({
      parameter: 'resting_pulse',
      observedValue: null,
      points: null,
      status: 'unavailable_from_wearable',
      rule: 'Not reported in calm context',
    });
  }

  const temp = latest.body_temperature;
  if (temp !== undefined) {
    scored += 1;
    const pts = temp <= 35.0 ? 3 : temp >= 39.1 ? 2 : temp <= 36.0 || temp >= 38.1 ? 1 : 0;
    total += pts;
    params.push({
      parameter: 'temperature',
      observedValue: Number(temp.toFixed(1)),
      points: pts,
      status: 'scored',
      rule: 'NEWS2 core temp scale',
    });
  } else {
    params.push({
      parameter: 'temperature',
      observedValue: null,
      points: null,
      status: 'unavailable_from_wearable',
      rule: 'Wearables capture relative skin temp unless thermometer logged',
    });
  }

  const sbp = latest.systolic_bp;
  if (sbp !== undefined) {
    scored += 1;
    const pts = sbp <= 90 || sbp >= 220 ? 3 : sbp <= 100 ? 2 : sbp <= 110 ? 1 : 0;
    total += pts;
    params.push({
      parameter: 'systolic_bp',
      observedValue: Number(sbp.toFixed(0)),
      points: pts,
      status: 'scored',
      rule: 'NEWS2 cuff BP scale',
    });
  } else {
    params.push({
      parameter: 'systolic_bp',
      observedValue: null,
      points: null,
      status: 'unavailable_from_wearable',
      rule: 'Requires BP cuff entry',
    });
  }

  params.push(
    {
      parameter: 'air_or_oxygen',
      observedValue: null,
      points: null,
      status: 'unavailable_from_wearable',
      rule: 'Supplemental oxygen requires clinical bedside entry',
    },
    {
      parameter: 'consciousness_acvpu',
      observedValue: null,
      points: null,
      status: 'unavailable_from_wearable',
      rule: 'ACVPU bedside assessment cannot be inferred by passive PPG',
    },
  );

  return {
    partialScore: total,
    maxObservablePoints: scored * 3,
    scoredParameterCount: scored,
    totalNews2Parameters: 7,
    spo2Scale,
    disclaimer:
      'Partial NEWS2 reflects wearable-observable metrics only; missing clinical bedside fields remain explicitly unscored.',
    parameters: params,
  };
}

function detectShiftChangepoints(buckets: HourlyBucket[], trace: number[]): string[] {
  if (trace.length < 18) return [];
  const sliceLen = Math.min(trace.length, 240);
  const arr = trace.slice(-sliceLen);
  const bSlice = buckets.slice(-sliceLen);

  // Rolling pre/post mean shift detector (min 6h before/after)
  let bestIdx = -1;
  let bestGap = 0;
  for (let i = 6; i <= arr.length - 6; i += 2) {
    const pre = arr.slice(Math.max(0, i - 18), i);
    const post = arr.slice(i, Math.min(arr.length, i + 12));
    const preMean = pre.reduce((a, b) => a + b, 0) / pre.length;
    const postMean = post.reduce((a, b) => a + b, 0) / post.length;
    const gap = postMean - preMean;
    if (gap > bestGap) {
      bestGap = gap;
      bestIdx = i;
    }
  }
  if (bestIdx >= 0 && bestGap >= 0.65 && bSlice[bestIdx]) {
    return [bSlice[bestIdx]!.hourIso];
  }
  return [];
}

export function evaluateLocalDeterministicEngine(params: {
  patientId: string;
  samples: TsSampleInput[];
  conditions: string[];
  age?: number;
  exclusions?: TsExclusionSpan[];
  environment?: TsEnvironmentInput | null;
  referenceNowIso?: string;
}): Omit<EngineEvaluationResult, 'explanationKn' | 'explanationHi'> {
  const { patientId, samples, conditions, exclusions = [], environment = null } = params;
  const parsedExcl = exclusions
    .map((e) => ({ start: Date.parse(e.startsAt), end: Date.parse(e.endsAt), reason: e.reason }))
    .filter((e) => Number.isFinite(e.start) && Number.isFinite(e.end) && e.end >= e.start);

  const grouped = new Map<number, TsSampleInput[]>();
  let latestSampleMs = 0;
  let isSynthetic = false;

  for (const s of samples) {
    const t = Date.parse(s.recordedAt);
    if (!Number.isFinite(t) || !Number.isFinite(s.value)) continue;
    if (s.isSynthetic) isSynthetic = true;
    if (t > latestSampleMs) latestSampleMs = t;
    const hourDate = new Date(t);
    hourDate.setUTCMinutes(0, 0, 0);
    const hMs = hourDate.getTime();
    const list = grouped.get(hMs) ?? [];
    list.push(s);
    grouped.set(hMs, list);
  }

  const sortedHours = [...grouped.keys()].sort((a, b) => a - b);
  const buckets: HourlyBucket[] = sortedHours.map((hMs) => {
    const pts = grouped.get(hMs)!;
    const byM = new Map<string, { vals: number[]; w: number[] }>();
    const contexts = new Set<string>();
    const confs: number[] = [];

    for (const p of pts) {
      contexts.add(p.context || 'unknown');
      const conf = Math.max(0.05, Math.min(1, Number.isFinite(p.dataConfidence) ? p.dataConfidence : 1));
      confs.push(conf);
      const entry = byM.get(p.metricType) ?? { vals: [], w: [] };
      entry.vals.push(p.value);
      entry.w.push(conf);
      byM.set(p.metricType, entry);
    }

    const metrics: Record<string, number> = {};
    const metricConfidences: Record<string, number> = {};
    for (const [m, grp] of byM) {
      metrics[m] =
        m === 'steps'
          ? grp.vals.reduce((a, b) => a + b, 0)
          : weightedMedian(grp.vals, grp.w);
      metricConfidences[m] = grp.w.reduce((a, b) => a + b, 0) / grp.w.length;
    }

    // Backfill resting_heart_rate from calm/sleep heart_rate when absent (matching Python engine)
    if (metrics.resting_heart_rate === undefined && metrics.heart_rate !== undefined) {
      const stepsHere = metrics.steps ?? 0;
      const calmPts = pts.filter(
        (p) =>
          p.metricType === 'heart_rate' &&
          (p.context === 'sleep' || p.context === 'rest' || (p.context === 'unknown' && stepsHere < 40)),
      );
      if (calmPts.length > 0) {
        metrics.resting_heart_rate = median(calmPts.map((p) => p.value));
        metricConfidences.resting_heart_rate =
          calmPts.reduce((acc, p) => acc + p.dataConfidence, 0) / calmPts.length;
      }
    }

    const d = new Date(hMs);
    const excluded = parsedExcl.some((sp) => hMs >= sp.start && hMs <= sp.end);
    return {
      hourMs: hMs,
      hourIso: d.toISOString(),
      dayKey: d.toISOString().slice(0, 10),
      circadianBlock: getCircadianBlock(d.getUTCHours()),
      metrics,
      metricConfidences,
      contexts,
      meanConfidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 1,
      excluded,
    };
  });

  const nowMs = params.referenceNowIso ? Date.parse(params.referenceNowIso) : latestSampleMs || Date.now();
  const nowIso = new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString();
  const { priors, weights, spo2Scale } = conditionWeights(conditions);

  if (buckets.length === 0) {
    return {
      patientId,
      assessedAt: nowIso,
      modelVersion: 'sentinel-ts-v2',
      engineSource: 'ts-fallback',
      isSynthetic,
      deteriorationIndex: 0,
      level: 'stable',
      baseline: {
        patientId,
        totalSpanDays: 0,
        validDays: 0,
        stage: 'warming_prior',
        statusLabel: 'Learning, day 0 of 14 (population prior anchored)',
        conditions,
        spo2Scale,
        metrics: Object.entries(priors).map(([metricType, [pm, psd]]) => ({
          metricType,
          context: 'calm_all',
          sampleCount: 0,
          validDays: 0,
          stage: 'warming_prior',
          median: pm,
          mad: Number((psd / 1.4826).toFixed(4)),
          sigma: psd,
          priorMean: pm,
          priorSd: psd,
          normalLow: Number((pm - 1.6 * psd).toFixed(2)),
          normalHigh: Number((pm + 1.6 * psd).toFixed(2)),
          hourlyOffsets: { night: 0, morning: 0, afternoon: 0, evening: 0 },
          baselineVersion: 'sentinel-ts-v2',
        })),
      },
      l1Score: 0,
      l2Score: 0,
      l3Score: 0,
      deviceSilent: true,
      hoursSilent: null,
      contributions: [],
      trend72h: [],
      changePoints: [],
      partialNews2: buildPartialNews2Ts({}, spo2Scale, false),
      decisionLog: {
        suppressedConfounders: ['no_telemetry_available'],
        l1Triggers: [],
        l3Details: { mode: 'ts-deterministic-v2' },
        recentConfidence: 1,
        weights,
      },
      summaryText: 'No wearable samples synced yet — pair a watch or sync Google Fit / Health Connect.',
    };
  }

  const nonExcluded = buckets.filter((b) => !b.excluded);
  const validDays = new Set(nonExcluded.map((b) => b.dayKey)).size;
  const spanDays = Math.max(1, Math.floor((buckets[buckets.length - 1]!.hourMs - buckets[0]!.hourMs) / 86_400_000) + 1);
  const tailCutoffMs = buckets[buckets.length - 1]!.hourMs - 48 * 3_600_000;
  const fitBuckets =
    spanDays >= 10 && nonExcluded.length > 120
      ? (() => {
          const pre = nonExcluded.filter((b) => b.hourMs <= tailCutoffMs);
          return pre.length >= 72 ? pre : nonExcluded;
        })()
      : nonExcluded;

  const globalStage =
    validDays >= 14 || (spanDays >= 14 && validDays >= 10)
      ? 'calibrated'
      : validDays >= 3
        ? 'learning'
        : 'warming_prior';

  const statusLabel =
    globalStage === 'calibrated'
      ? `Calibrated to personal normal (${validDays} valid days)`
      : `Learning, day ${Math.min(validDays, 14)} of 14`;

  // Fit personal baselines for EVERY present or prior metric
  const presentMetricNames = new Set<string>(Object.keys(priors));
  for (const b of fitBuckets) {
    for (const k of Object.keys(b.metrics)) presentMetricNames.add(k);
  }

  const baselineMap = new Map<
    string,
    {
      metricType: string;
      stage: string;
      validDays: number;
      sampleCount: number;
      median: number;
      mad: number;
      sigma: number;
      priorMean: number;
      priorSd: number;
      normalLow: number;
      normalHigh: number;
      hourlyOffsets: Record<string, number>;
      baselineVersion: string;
    }
  >();

  for (const m of presentMetricNames) {
    const [priorMean, priorSd] = priors[m] ?? [50, 10];
    const floorSigma = MIN_SIGMA_FLOOR[m] ?? 1.0;

    const rows = fitBuckets.filter((b) => {
      if (b.metrics[m] === undefined) return false;
      if (
        (m === 'resting_heart_rate' || m === 'heart_rate' || m === 'respiratory_rate') &&
        b.contexts.has('exercise') &&
        b.contexts.size === 1
      ) {
        return false;
      }
      if (m === 'steps' && b.circadianBlock === 'night') return false;
      return true;
    });

    const mDays = new Set(rows.map((b) => b.dayKey)).size;
    const shrinkW = mDays > 0 ? Math.min(0.95, mDays / (mDays + 5)) : 0;

    if (rows.length < 4) {
      // If >=1 real observations exist but <4, still expose them via gentle shrinkage rather than freezing if >0 days
      const sigma = Math.max(priorSd, floorSigma);
      baselineMap.set(m, {
        metricType: m,
        stage: mDays >= 3 ? 'learning' : 'warming_prior',
        validDays: mDays,
        sampleCount: rows.length,
        median: priorMean,
        mad: Number((sigma / 1.4826).toFixed(4)),
        sigma,
        priorMean,
        priorSd,
        normalLow: Number((priorMean - 1.6 * sigma).toFixed(2)),
        normalHigh: Number((priorMean + 1.6 * sigma).toFixed(2)),
        hourlyOffsets: { night: 0, morning: 0, afternoon: 0, evening: 0 },
        baselineVersion: 'sentinel-ts-v2',
      });
      continue;
    }

    const vals = rows.map((b) => b.metrics[m]!);
    const confs = rows.map((b) => b.metricConfidences[m] ?? b.meanConfidence);
    const medRaw = weightedMedian(vals, confs);
    const madRaw = Math.max(median(vals.map((v) => Math.abs(v - medRaw))), floorSigma / 1.4826);
    const sigmaRaw = Math.max(1.4826 * madRaw, floorSigma);

    const clean = rows.filter((b) => Math.abs(b.metrics[m]! - medRaw) <= 3.5 * sigmaRaw);
    const usedRows = clean.length >= 4 ? clean : rows;
    const cVals = usedRows.map((b) => b.metrics[m]!);
    const cConfs = usedRows.map((b) => b.metricConfidences[m] ?? b.meanConfidence);

    const medPerson = weightedMedian(cVals, cConfs);
    const madPerson = median(cVals.map((v) => Math.abs(v - medPerson)));
    const sigmaPerson = Math.max(1.4826 * madPerson, floorSigma);

    const postMean = Number((shrinkW * medPerson + (1 - shrinkW) * priorMean).toFixed(4));
    const postSigma = Number(Math.max(shrinkW * sigmaPerson + (1 - shrinkW) * priorSd, floorSigma).toFixed(4));
    const postMad = Number((postSigma / 1.4826).toFixed(4));

    const hourlyOffsets: Record<string, number> = {};
    for (const block of ['night', 'morning', 'afternoon', 'evening'] as const) {
      const bVals = usedRows.filter((b) => b.circadianBlock === block).map((b) => b.metrics[m]!);
      if (bVals.length >= 4) {
        const diff = median(bVals) - postMean;
        const damp = bVals.length / (bVals.length + 12);
        hourlyOffsets[block] = Number(Math.max(-2 * postSigma, Math.min(2 * postSigma, diff * damp)).toFixed(4));
      } else {
        hourlyOffsets[block] = 0;
      }
    }

    const mStage = mDays >= 14 ? 'calibrated' : mDays >= 3 ? 'learning' : 'warming_prior';
    baselineMap.set(m, {
      metricType: m,
      stage: mStage,
      validDays: mDays,
      sampleCount: usedRows.length,
      median: postMean,
      mad: postMad,
      sigma: postSigma,
      priorMean,
      priorSd,
      normalLow: Number((postMean - 1.6 * postSigma).toFixed(2)),
      normalHigh: Number((postMean + 1.6 * postSigma).toFixed(2)),
      hourlyOffsets,
      baselineVersion: 'sentinel-ts-v2',
    });
  }

  // L1 Clinical Safety Rules across recent calm 12h
  const recent12 = buckets.slice(-12);
  const calmRecent = recent12.filter((b) => !(b.contexts.has('exercise') && (b.metrics.steps ?? 0) >= 40));
  const suppressed: string[] = [];
  if (calmRecent.length < recent12.length) suppressed.push('exercise_hr_elevated_during_high_steps');

  let l1Score = 0;
  const l1Triggers: Array<Record<string, unknown>> = [];
  const spo2Crit = spo2Scale === 2 ? 84 : 88;
  const spo2Warn = spo2Scale === 2 ? 86 : 91;

  for (const b of calmRecent.slice(-6)) {
    const spo2 = b.metrics.spo2;
    if (spo2 !== undefined && b.meanConfidence >= 0.45) {
      if (spo2 < spo2Crit) {
        l1Score = Math.max(l1Score, 92);
        l1Triggers.push({ rule: 'critical_hypoxemia', value: spo2, severity: 'urgent' });
      } else if (spo2 <= spo2Warn) {
        l1Score = Math.max(l1Score, 62);
        l1Triggers.push({ rule: 'low_spo2_threshold', value: spo2, severity: 'warning' });
      }
    }
    const rr = b.metrics.respiratory_rate;
    if (rr !== undefined) {
      if (rr >= 25 || rr <= 8) {
        l1Score = Math.max(l1Score, 78);
        l1Triggers.push({ rule: 'news2_respiratory_extreme', value: rr, severity: 'urgent' });
      } else if (rr >= 21) {
        l1Score = Math.max(l1Score, 44);
        l1Triggers.push({ rule: 'elevated_respiratory_rate', value: rr, severity: 'watch' });
      }
    }
    const calmPulse =
      b.metrics.resting_heart_rate ??
      ((b.metrics.steps ?? 0) < 20 ? b.metrics.heart_rate : undefined);
    if (calmPulse !== undefined) {
      if (calmPulse >= 131 || calmPulse <= 40) {
        l1Score = Math.max(l1Score, 85);
        l1Triggers.push({ rule: 'news2_resting_pulse_extreme', value: calmPulse, severity: 'urgent' });
      } else if (calmPulse >= 115) {
        l1Score = Math.max(l1Score, 58);
        l1Triggers.push({ rule: 'resting_tachycardia', value: calmPulse, severity: 'warning' });
      }
    }
    const sbp = b.metrics.systolic_bp;
    if (sbp !== undefined && (sbp >= 180 || sbp <= 85)) {
      l1Score = Math.max(l1Score, 80);
      l1Triggers.push({ rule: 'bp_safety_bound', value: sbp, severity: 'urgent' });
    }
  }

  // L2 Chronological Directional Z + EWMA + CUSUM + Change-Points
  const scoredMetrics = [...new Set([...MULTIVARIATE_METRICS, ...buckets.flatMap((b) => Object.keys(b.metrics))])].filter(
    (m) => baselineMap.has(m),
  );
  const ewma = new Map<string, number>();
  const cusum = new Map<string, number>();
  const maxRecentZ = new Map<string, number>();
  const matrixRows: number[][] = [];
  const trace: number[] = [];

  for (let t = 0; t < buckets.length; t += 1) {
    const b = buckets[t]!;
    const isEx = b.contexts.has('exercise') && (b.metrics.steps ?? 0) >= 40;
    const rowTerms: number[] = [];
    const mvRow: number[] = [];

    for (const m of scoredMetrics) {
      const bl = baselineMap.get(m)!;
      const obs = b.metrics[m];
      if (obs === undefined) {
        ewma.set(m, (ewma.get(m) ?? 0) * 0.85);
        if (MULTIVARIATE_METRICS.includes(m as (typeof MULTIVARIATE_METRICS)[number])) mvRow.push(0);
        continue;
      }
      let rz = 0;
      if (!(isEx && (m === 'resting_heart_rate' || m === 'heart_rate' || m === 'respiratory_rate' || m === 'steps'))) {
        const expected = bl.median + (bl.hourlyOffsets[b.circadianBlock] ?? 0);
        const sZ = signedZ(m, obs, expected, bl.sigma);
        const conf = b.metricConfidences[m] ?? b.meanConfidence;
        rz = Math.min(6, Math.max(0, sZ.riskZ * Math.min(1, conf + 0.15)));
      }
      const nextEwma = 0.25 * rz + 0.75 * (ewma.get(m) ?? 0);
      const nextCusum = Math.max(0, Math.min(14, (cusum.get(m) ?? 0) + (rz - 0.85)));
      ewma.set(m, nextEwma);
      cusum.set(m, nextCusum);
      if (t >= Math.max(0, buckets.length - 12)) {
        maxRecentZ.set(m, Math.max(maxRecentZ.get(m) ?? 0, rz));
      }
      rowTerms.push(rz * (weights[m] ?? 1.0));
      if (MULTIVARIATE_METRICS.includes(m as (typeof MULTIVARIATE_METRICS)[number])) mvRow.push(rz);
    }

    matrixRows.push(mvRow);
    trace.push(rowTerms.length ? rowTerms.reduce((a, b) => a + b, 0) / rowTerms.length : 0);
  }

  const changePoints = detectShiftChangepoints(buckets, trace);

  const heatLevel = String(environment?.heatRiskLevel ?? 'normal');
  const heatConfounder =
    heatLevel === 'high' || heatLevel === 'extreme' || (typeof environment?.apparentTempC === 'number' && environment.apparentTempC >= 34);
  if (heatConfounder) suppressed.push('ambient_heat_stress_context');

  const lastBucket = buckets[buckets.length - 1]!;
  const exerciseRecent = lastBucket.contexts.has('exercise') && (lastBucket.metrics.steps ?? 0) >= 40;
  if (exerciseRecent) suppressed.push('active_exercise_suppressed');

  const latestMerged: Record<string, number> = {};
  for (let i = buckets.length - 1; i >= Math.max(0, buckets.length - 12); i -= 1) {
    for (const [k, v] of Object.entries(buckets[i]!.metrics)) {
      if (latestMerged[k] === undefined) latestMerged[k] = v;
    }
  }

  const contributions: SignalContribution[] = [];
  const weightedTerms: number[] = [];

  for (const m of scoredMetrics) {
    const obs = latestMerged[m];
    const bl = baselineMap.get(m);
    if (obs === undefined || !bl) continue;
    const condW = weights[m] ?? 1.0;
    let zEff = Math.max(ewma.get(m) ?? 0, 0.65 * (maxRecentZ.get(m) ?? 0));
    const cEff = cusum.get(m) ?? 0;
    if (heatConfounder && (m === 'resting_heart_rate' || m === 'skin_temp_deviation') && zEff < 2.2) {
      zEff *= 0.85;
    }
    const signalScore = condW * (16.5 * zEff + 4.8 * cEff);
    weightedTerms.push(signalScore);

    const { rawZ, dir } = signedZ(m, obs, bl.median, bl.sigma);
    const [label, unit] = FRIENDLY_NAMES[m] ?? [m, ''];
    const msg =
      dir === 'normal' || zEff < 0.7
        ? `${label} (${obs.toFixed(1)} ${unit}) is within your personal normal (${bl.normalLow}–${bl.normalHigh}).`
        : dir === 'higher' || dir === 'erratic_high'
          ? `${label} (${obs.toFixed(1)} ${unit}) is higher than your personal normal (${bl.normalLow}–${bl.normalHigh}).`
          : `${label} (${obs.toFixed(1)} ${unit}) is lower than your personal normal (${bl.normalLow}–${bl.normalHigh}).`;

    contributions.push({
      metricType: m,
      label,
      unit,
      observed: Number(obs.toFixed(2)),
      personalMedian: Number(bl.median.toFixed(2)),
      normalLow: bl.normalLow,
      normalHigh: bl.normalHigh,
      zScore: Number(rawZ.toFixed(2)),
      ewmaZ: Number((ewma.get(m) ?? 0).toFixed(2)),
      cusum: Number(cEff.toFixed(2)),
      direction: dir,
      rawContribution: Number(signalScore.toFixed(2)),
      sharePct: 0,
      message: msg,
    });
  }

  contributions.sort((a, b) => b.rawContribution - a.rawContribution);
  const totalRaw = contributions.reduce((acc, c) => acc + Math.max(0, c.rawContribution), 0);
  if (totalRaw > 0) {
    for (const c of contributions) {
      c.sharePct = Number(((100 * Math.max(0, c.rawContribution)) / totalRaw).toFixed(1));
    }
  }

  const top3 = [...weightedTerms].sort((a, b) => b - a).slice(0, 3);
  let l2Core = top3.length > 0 ? top3.reduce((a, b) => a + b, 0) / top3.length : 0;
  const coincident = contributions.filter((c) => c.rawContribution >= 20).length;
  if (coincident >= 2) l2Core *= 1 + 0.14 * Math.min(3, coincident - 1);
  const l2Score = Math.min(100, Math.max(0, Number(l2Core.toFixed(2))));

  // L3 Multivariate diagonal Mahalanobis + Multi-signal Coherence
  let l3Score = 0;
  let mahaDist = 0;
  const activeMvCols = MULTIVARIATE_METRICS.filter((m) => latestMerged[m] !== undefined);
  if (buckets.length >= 24 && activeMvCols.length >= 2) {
    const evalTail = matrixRows.slice(-8);
    const d2Vals = evalTail.map((row) => row.reduce((acc, v) => acc + v * v, 0));
    const maxD2 = d2Vals.sort((a, b) => a - b)[Math.floor(d2Vals.length * 0.85)] ?? 0;
    mahaDist = Number(Math.sqrt(maxD2).toFixed(3));
    const coherenceFactor = activeMvCols.length;
    l3Score = Number(
      Math.min(100, Math.max(0, (maxD2 / Math.max(2, coherenceFactor) - 0.8) * 18)).toFixed(2),
    );
  }

  const hoursSilent = Math.max(0, Number(((nowMs - latestSampleMs) / 3_600_000).toFixed(2)));
  const deviceSilent = hoursSilent >= 12.0;

  const recentConf = buckets.slice(-6).reduce((acc, b) => acc + b.meanConfidence, 0) / Math.min(6, buckets.length);
  const qualityFactor = recentConf < 0.55 ? 0.78 : 1.0;

  let fused = Math.max(l1Score, qualityFactor * (0.3 * l1Score + 0.5 * l2Score + 0.2 * l3Score));
  if (changePoints.length >= 1 && l2Score >= 28) fused = Math.min(100, fused + 5);
  if (deviceSilent && fused < 32) fused = 34;

  const deteriorationIndex = Number(Math.min(100, Math.max(0, fused)).toFixed(1));
  const level: AlertLevel =
    deteriorationIndex >= 80 || l1Score >= 82
      ? 'urgent'
      : deteriorationIndex >= 55
        ? 'warning'
        : deteriorationIndex >= 30 || deviceSilent
          ? 'watch'
          : 'stable';

  const trend72h = buckets.slice(-72).map((b, i) => {
    const traceIdx = Math.max(0, buckets.length - 72) + i;
    return {
      timestamp: b.hourIso,
      score: Number(Math.min(100, Math.max(0, (trace[traceIdx] ?? 0) * 26)).toFixed(1)),
      confidence: Number(b.meanConfidence.toFixed(2)),
      excluded: b.excluded,
    };
  });

  const topDrivers = contributions.filter((c) => c.rawContribution >= 14).slice(0, 3).map((c) => c.label);
  const summaryText =
    level === 'stable'
      ? `Readings look consistent with your personal normal (${statusLabel}).`
      : deviceSilent && topDrivers.length === 0
        ? `No wearable readings received for ${Math.round(hoursSilent)}h — check watch battery or fit.`
        : `Notable changes from your personal normal in ${topDrivers.join(', ') || 'combined patterns'}. Early awareness signal only — check how the person feels or contact a doctor if unwell.`;

  return {
    patientId,
    assessedAt: nowIso,
    modelVersion: 'sentinel-ts-v2',
    engineSource: 'ts-fallback',
    isSynthetic,
    deteriorationIndex,
    level,
    baseline: {
      patientId,
      totalSpanDays: spanDays,
      validDays,
      stage: globalStage,
      statusLabel,
      conditions,
      spo2Scale,
      metrics: [...baselineMap.values()].map((m) => ({
        metricType: m.metricType,
        context: 'calm_all',
        sampleCount: m.sampleCount,
        validDays: m.validDays,
        stage: m.stage,
        median: m.median,
        mad: m.mad,
        sigma: m.sigma,
        priorMean: m.priorMean,
        priorSd: m.priorSd,
        normalLow: m.normalLow,
        normalHigh: m.normalHigh,
        hourlyOffsets: m.hourlyOffsets,
        baselineVersion: m.baselineVersion,
      })),
    },
    l1Score,
    l2Score,
    l3Score,
    deviceSilent,
    hoursSilent,
    contributions: contributions.slice(0, 8),
    trend72h,
    changePoints,
    partialNews2: buildPartialNews2Ts(latestMerged, spo2Scale, exerciseRecent),
    decisionLog: {
      suppressedConfounders: suppressed,
      l1Triggers,
      l3Details: {
        mode: 'ts-deterministic-v2',
        mahalanobisDistance: mahaDist,
        multivariateMetricsCount: activeMvCols.length,
      },
      recentConfidence: Number(recentConf.toFixed(3)),
      weights,
    },
    summaryText,
  };
}
