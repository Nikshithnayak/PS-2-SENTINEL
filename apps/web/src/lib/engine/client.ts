import type { AlertLevel } from '@sentinel/shared';
import { and, desc, eq, gte } from 'drizzle-orm';
import { appendAuditLog, withSystemDb } from '@/db';
import {
  baselineStates,
  detectorDecisionLogs,
  environmentSnapshots,
  excludedPeriods,
  patientProfiles,
  riskAssessments,
  vitalSamples,
} from '@/db/schema';

export interface SignalContribution {
  metricType: string;
  label: string;
  unit: string;
  observed: number;
  personalMedian: number;
  normalLow: number;
  normalHigh: number;
  zScore: number;
  ewmaZ: number;
  cusum: number;
  direction: string;
  rawContribution: number;
  sharePct: number;
  message: string;
}

export interface EngineEvaluationResult {
  patientId: string;
  assessedAt: string;
  modelVersion: string;
  engineSource: 'python-engine' | 'ts-fallback';
  isSynthetic: boolean;
  deteriorationIndex: number;
  level: AlertLevel;
  baseline: {
    patientId: string;
    totalSpanDays: number;
    validDays: number;
    stage: string;
    statusLabel: string;
    conditions: string[];
    spo2Scale: number;
    metrics: Array<{
      metricType: string;
      context: string;
      sampleCount: number;
      validDays: number;
      stage: string;
      median: number;
      mad: number;
      sigma: number;
      priorMean: number;
      priorSd: number;
      normalLow: number;
      normalHigh: number;
      hourlyOffsets: Record<string, number>;
      baselineVersion: string;
    }>;
  };
  l1Score: number;
  l2Score: number;
  l3Score: number;
  deviceSilent: boolean;
  hoursSilent: number | null;
  contributions: SignalContribution[];
  trend72h: Array<{ timestamp: string; score: number; confidence: number; excluded: boolean }>;
  changePoints: string[];
  partialNews2: {
    partialScore: number;
    maxObservablePoints: number;
    scoredParameterCount: number;
    totalNews2Parameters: number;
    spo2Scale: number;
    disclaimer: string;
    parameters: Array<{
      parameter: string;
      observedValue: number | null;
      points: number | null;
      status: string;
      rule: string;
    }>;
  };
  decisionLog: {
    suppressedConfounders: string[];
    l1Triggers: Array<Record<string, unknown>>;
    l3Details: Record<string, unknown>;
    recentConfidence?: number;
    weights?: Record<string, number>;
  };
  summaryText: string;
  explanationKn: string;
  explanationHi: string;
}

function ageBandToApproxAge(ageBand: string | null | undefined): number {
  if (!ageBand) return 72;
  if (ageBand.startsWith('80')) return 83;
  if (ageBand.startsWith('70')) return 74;
  if (ageBand.startsWith('60')) return 64;
  return 72;
}

function buildLocalizedSummaries(
  level: AlertLevel,
  topLabels: string[],
  validDays: number,
  summaryEn: string,
): { en: string; kn: string; hi: string } {
  const drivers = topLabels.slice(0, 2).join(', ') || 'vitals';
  if (level === 'stable') {
    return {
      en: summaryEn,
      kn: `ನಿಮ್ಮ ವೈಯಕ್ತಿಕ ಸಾಮಾನ್ಯ ಮಟ್ಟಕ್ಕೆ (${validDays} ದಿನಗಳ ಆಧಾರ) ಹೋಲಿಸಿದರೆ ಇಂದಿನ ಮಾಪನಗಳು ಸ್ಥಿರವಾಗಿವೆ.`,
      hi: `आपके व्यक्तिगत सामान्य स्तर (${validDays} दिनों का आधार) की तुलना में आज के माप स्थिर हैं।`,
    };
  }
  return {
    en: summaryEn,
    kn: `${drivers} ನಲ್ಲಿ ನಿಮ್ಮ ವೈಯಕ್ತಿಕ ಸಾಮಾನ್ಯ ಮಟ್ಟಕ್ಕಿಂತ ಬದಲಾವಣೆ ಕಂಡುಬಂದಿದೆ. ಇದು ರೋಗನಿರ್ಣಯವಲ್ಲ — ಆರೋಗ್ಯ ಸ್ಥಿತಿ ಗಮನಿಸಿ ಅಥವಾ ವೈದ್ಯರನ್ನು ಸಂಪರ್ಕಿಸಿ.`,
    hi: `${drivers} में आपके व्यक्तिगत सामान्य स्तर से बदलाव देखा गया है। यह चिकित्सा निदान नहीं है — स्थिति की जांच करें या डॉक्टर से संपर्क करें।`,
  };
}

/**
 * Emergency deterministic TS mirror used only if the Python FastAPI service is offline.
 */
function fallbackEvaluateLocal(params: {
  patientId: string;
  samples: Array<{
    metricType: string;
    value: number;
    recordedAt: string;
    context: string;
    dataConfidence: number;
    isSynthetic: boolean;
  }>;
  conditions: string[];
}): EngineEvaluationResult {
  const { patientId, samples, conditions } = params;
  const nowIso = new Date().toISOString();
  const isSynthetic = samples.some((s) => s.isSynthetic);
  const byMetric = new Map<string, number[]>();
  const latest = new Map<string, number>();

  for (const s of samples) {
    const arr = byMetric.get(s.metricType) ?? [];
    arr.push(s.value);
    byMetric.set(s.metricType, arr);
    latest.set(s.metricType, s.value);
  }

  const rhrList = byMetric.get('resting_heart_rate') ?? [65];
  const rhrSorted = [...rhrList].sort((a, b) => a - b);
  const rhrMedian = rhrSorted[Math.floor(rhrSorted.length / 2)] ?? 65;
  const latestRhr = latest.get('resting_heart_rate') ?? rhrMedian;
  const rhrZ = (latestRhr - rhrMedian) / 4.0;

  const spo2List = byMetric.get('spo2') ?? [97];
  const latestSpo2 = latest.get('spo2') ?? 97;
  const spo2Drop = Math.max(0, 96 - latestSpo2);

  const l1 = latestSpo2 < 88 || latestRhr > 130 ? 85 : latestRhr > 110 ? 55 : 0;
  const l2 = Math.min(100, Math.max(0, rhrZ * 18 + spo2Drop * 8));
  const index = Math.round(Math.min(100, Math.max(l1, 0.4 * l1 + 0.6 * l2)) * 10) / 10;
  const level: AlertLevel =
    index >= 80 ? 'urgent' : index >= 55 ? 'warning' : index >= 30 ? 'watch' : 'stable';

  const days = Math.min(
    18,
    new Set(samples.map((s) => s.recordedAt.slice(0, 10))).size,
  );
  const stage = days >= 14 ? 'calibrated' : days >= 3 ? 'learning' : 'warming_prior';
  const summaryEn =
    level === 'stable'
      ? `Readings look consistent with your personal normal (${stage}).`
      : 'Notable changes from your personal normal detected (TS fallback mode).';
  const localized = buildLocalizedSummaries(level, ['Resting Heart Rate', 'SpO2'], days, summaryEn);

  return {
    patientId,
    assessedAt: nowIso,
    modelVersion: 'sentinel-ts-fallback-v1',
    engineSource: 'ts-fallback',
    isSynthetic,
    deteriorationIndex: index,
    level,
    baseline: {
      patientId,
      totalSpanDays: days,
      validDays: days,
      stage,
      statusLabel: `Fallback baseline (${days} valid days)`,
      conditions,
      spo2Scale: conditions.includes('copd') ? 2 : 1,
      metrics: [
        {
          metricType: 'resting_heart_rate',
          context: 'calm_all',
          sampleCount: rhrList.length,
          validDays: days,
          stage,
          median: rhrMedian,
          mad: 3.0,
          sigma: 4.5,
          priorMean: 66,
          priorSd: 7.5,
          normalLow: rhrMedian - 7,
          normalHigh: rhrMedian + 7,
          hourlyOffsets: { night: -1, morning: 0, afternoon: 1, evening: 0 },
          baselineVersion: 'sentinel-ts-fallback-v1',
        },
      ],
    },
    l1Score: l1,
    l2Score: l2,
    l3Score: 0,
    deviceSilent: samples.length === 0,
    hoursSilent: 0,
    contributions: [
      {
        metricType: 'resting_heart_rate',
        label: 'Resting Heart Rate',
        unit: 'bpm',
        observed: latestRhr,
        personalMedian: rhrMedian,
        normalLow: rhrMedian - 7,
        normalHigh: rhrMedian + 7,
        zScore: Math.round(rhrZ * 100) / 100,
        ewmaZ: Math.round(rhrZ * 100) / 100,
        cusum: 0,
        direction: rhrZ > 0.8 ? 'higher' : 'normal',
        rawContribution: Math.round(l2),
        sharePct: 100,
        message: `Resting Heart Rate (${latestRhr.toFixed(1)} bpm) vs personal normal.`,
      },
    ],
    trend72h: [{ timestamp: nowIso, score: index, confidence: 1, excluded: false }],
    changePoints: [],
    partialNews2: {
      partialScore: 0,
      maxObservablePoints: 9,
      scoredParameterCount: 3,
      totalNews2Parameters: 7,
      spo2Scale: conditions.includes('copd') ? 2 : 1,
      disclaimer: 'Partial fallback NEWS2.',
      parameters: [],
    },
    decisionLog: {
      suppressedConfounders: [],
      l1Triggers: [],
      l3Details: { mode: 'ts-fallback' },
    },
    summaryText: localized.en,
    explanationKn: localized.kn,
    explanationHi: localized.hi,
  };
}

export async function runAndPersistEvaluation(params: {
  patientId: string;
  actorUserId?: string | null;
}): Promise<EngineEvaluationResult> {
  const { patientId, actorUserId = null } = params;

  const dbInput = await withSystemDb(async (tx) => {
    const profileRows = await tx
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.id, patientId))
      .limit(1);

    const profile = profileRows[0];
    if (!profile) {
      throw new Error(`Patient ${patientId} not found`);
    }

    const since = new Date(Date.now() - 25 * 24 * 3_600_000);
    const vitals = await tx
      .select()
      .from(vitalSamples)
      .where(and(eq(vitalSamples.patientId, patientId), gte(vitalSamples.recordedAt, since)));

    vitals.sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());

    const exclusions = await tx
      .select()
      .from(excludedPeriods)
      .where(eq(excludedPeriods.patientId, patientId));

    const envRows = await tx
      .select()
      .from(environmentSnapshots)
      .orderBy(desc(environmentSnapshots.fetchedAt))
      .limit(1);

    return {
      profile,
      vitals,
      exclusions,
      environment: envRows[0] ?? null,
    };
  });

  const payloadSamples = dbInput.vitals.map((v) => ({
    metricType: v.metricType,
    value: v.value,
    unit: v.unit,
    recordedAt: v.recordedAt.toISOString(),
    context: v.context,
    dataConfidence: v.dataConfidence,
    qualityFlags: v.qualityFlags,
    isSynthetic: v.isSynthetic,
  }));

  const payloadExclusions = dbInput.exclusions.map((e) => ({
    startsAt: e.startAt.toISOString(),
    endsAt: e.endAt.toISOString(),
    reason: e.reason,
  }));

  const engineUrl = process.env.ENGINE_URL ?? 'http://127.0.0.1:8000';
  const approxAge = ageBandToApproxAge(dbInput.profile.ageBand);
  let evaluated: EngineEvaluationResult | null = null;

  try {
    const resp = await fetch(`${engineUrl}/v1/score/evaluate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        patientId,
        samples: payloadSamples,
        conditions: dbInput.profile.conditionModules,
        age: approxAge,
        exclusions: payloadExclusions,
        environment: dbInput.environment
          ? {
              apparentTempC: dbInput.environment.apparentTempC,
              heatRiskLevel: dbInput.environment.heatRiskLevel,
              pm25: dbInput.environment.pm25,
            }
          : null,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (resp.ok) {
      const py = (await resp.json()) as Omit<
        EngineEvaluationResult,
        'engineSource' | 'explanationKn' | 'explanationHi'
      >;
      const localized = buildLocalizedSummaries(
        py.level,
        py.contributions.map((c) => c.label),
        py.baseline.validDays,
        py.summaryText,
      );
      evaluated = {
        ...py,
        engineSource: 'python-engine',
        explanationKn: localized.kn,
        explanationHi: localized.hi,
      };
    }
  } catch {
    evaluated = null;
  }

  if (!evaluated) {
    evaluated = fallbackEvaluateLocal({
      patientId,
      samples: payloadSamples,
      conditions: dbInput.profile.conditionModules,
    });
  }

  // Persist baseline states, risk assessment, and immutable detector decision log
  const assessedDate = new Date(evaluated.assessedAt);
  await withSystemDb(async (tx) => {
    for (const mb of evaluated.baseline.metrics.slice(0, 16)) {
      const existing = await tx
        .select({ id: baselineStates.id })
        .from(baselineStates)
        .where(
          and(
            eq(baselineStates.patientId, patientId),
            eq(baselineStates.metricType, mb.metricType),
            eq(baselineStates.context, mb.context),
          ),
        )
        .limit(1);

      if (existing[0]) {
        await tx
          .update(baselineStates)
          .set({
            modelVersion: mb.baselineVersion,
            calibrationDays: evaluated.baseline.totalSpanDays,
            validDays: mb.validDays,
            status: mb.stage,
            medianVal: mb.median,
            madVal: mb.mad,
            priorMean: mb.priorMean,
            priorStd: mb.priorSd,
            circadianOffsets: mb.hourlyOffsets,
            updatedAt: assessedDate,
          })
          .where(eq(baselineStates.id, existing[0].id));
      } else {
        await tx.insert(baselineStates).values({
          patientId,
          metricType: mb.metricType,
          context: mb.context,
          modelVersion: mb.baselineVersion,
          calibrationDays: evaluated.baseline.totalSpanDays,
          validDays: mb.validDays,
          status: mb.stage,
          medianVal: mb.median,
          madVal: mb.mad,
          priorMean: mb.priorMean,
          priorStd: mb.priorSd,
          circadianOffsets: mb.hourlyOffsets,
          updatedAt: assessedDate,
        });
      }
    }

    await tx.insert(riskAssessments).values({
      patientId,
      assessedAt: assessedDate,
      deteriorationIndex: evaluated.deteriorationIndex,
      level: evaluated.level,
      confidence: Number(evaluated.decisionLog.recentConfidence ?? 1.0),
      l1Score: evaluated.l1Score,
      l2Score: evaluated.l2Score,
      l3Score: evaluated.l3Score,
      partialNews2: evaluated.partialNews2 as unknown as Record<string, unknown>,
      contributions: evaluated.contributions as unknown as Array<Record<string, unknown>>,
      trend72h: evaluated.trend72h.map((pt) => ({ ts: pt.timestamp, index: pt.score })),
      explanationEn: evaluated.summaryText,
      explanationKn: evaluated.explanationKn,
      explanationHi: evaluated.explanationHi,
      isSynthetic: evaluated.isSynthetic,
    });

    await tx.insert(detectorDecisionLogs).values({
      patientId,
      assessedAt: assessedDate,
      modelVersion: evaluated.modelVersion,
      firedAlert: evaluated.level !== 'stable',
      suppressionReason: evaluated.decisionLog.suppressedConfounders.join(', ') || null,
      decisionPayload: {
        engineSource: evaluated.engineSource,
        deteriorationIndex: evaluated.deteriorationIndex,
        level: evaluated.level,
        l1Score: evaluated.l1Score,
        l2Score: evaluated.l2Score,
        l3Score: evaluated.l3Score,
        changePoints: evaluated.changePoints,
        l3Details: evaluated.decisionLog.l3Details,
      },
    });

    await appendAuditLog(tx, {
      actorUserId,
      action: 'engine.evaluated',
      targetType: 'risk_assessment',
      targetId: patientId,
      payload: {
        patientId,
        engineSource: evaluated.engineSource,
        modelVersion: evaluated.modelVersion,
        deteriorationIndex: evaluated.deteriorationIndex,
        level: evaluated.level,
        isSynthetic: evaluated.isSynthetic,
      },
    });
  });

  return evaluated;
}
