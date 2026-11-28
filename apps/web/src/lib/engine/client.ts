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
import { evaluateLocalDeterministicEngine } from '@/lib/engine/ts-fallback';

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
  riskAssessmentId?: string;
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
 * Deterministic TypeScript mirror of the Python FastAPI engine (used automatically
 * on Vercel serverless deployments where ENGINE_URL is unset or offline).
 */
function fallbackEvaluateLocal(params: {
  patientId: string;
  samples: Array<{
    metricType: string;
    value: number;
    unit: string;
    recordedAt: string;
    context: string;
    dataConfidence: number;
    qualityFlags?: string[];
    isSynthetic: boolean;
  }>;
  conditions: string[];
  age?: number;
  exclusions?: Array<{ startsAt: string; endsAt: string; reason: string }>;
  environment?: {
    apparentTempC?: number | null;
    heatRiskLevel?: string | null;
    pm25?: number | null;
  } | null;
}): EngineEvaluationResult {
  const res = evaluateLocalDeterministicEngine({
    patientId: params.patientId,
    samples: params.samples,
    conditions: params.conditions,
    age: params.age,
    exclusions: params.exclusions,
    environment: params.environment,
  });
  const localized = buildLocalizedSummaries(
    res.level,
    res.contributions.map((c) => c.label),
    res.baseline.validDays,
    res.summaryText,
  );
  return {
    ...res,
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

  const configuredEngineUrl = process.env.ENGINE_URL?.trim();
  const engineUrl = configuredEngineUrl ?? 'http://127.0.0.1:8000';
  const shouldAttemptRemoteEngine = Boolean(configuredEngineUrl || !process.env.VERCEL);
  const approxAge = ageBandToApproxAge(dbInput.profile.ageBand);
  let evaluated: EngineEvaluationResult | null = null;

  if (shouldAttemptRemoteEngine) {
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
        signal: AbortSignal.timeout(20_000),
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
      } else {
        const errText = await resp.text().catch(() => '');
        console.warn(`[sentinel-engine] Python /v1/score/evaluate returned HTTP ${resp.status}: ${errText.slice(0, 300)}`);
      }
    } catch (err) {
      console.warn('[sentinel-engine] Python evaluation fetch failed, using TS fallback:', err);
      evaluated = null;
    }
  }

  if (!evaluated) {
    evaluated = fallbackEvaluateLocal({
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
    });
  }

  // Persist baseline states, risk assessment, and immutable detector decision log.
  // Use evaluation execution time when the engine reports a top-of-hour bucket timestamp
  // so newer evaluations never sort behind earlier within-the-hour fallback assessments.
  const parsedAssessed = new Date(evaluated.assessedAt);
  const nowDate = new Date();
  const assessedDate =
    Number.isNaN(parsedAssessed.getTime()) || parsedAssessed.getTime() < nowDate.getTime()
      ? nowDate
      : parsedAssessed;
  const assessmentId = await withSystemDb(async (tx) => {
    for (const mb of evaluated.baseline.metrics.slice(0, 20)) {
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

    const [insertedAssessment] = await tx
      .insert(riskAssessments)
      .values({
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
      })
      .returning({ id: riskAssessments.id });

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
      targetId: insertedAssessment?.id ?? patientId,
      payload: {
        patientId,
        engineSource: evaluated.engineSource,
        modelVersion: evaluated.modelVersion,
        deteriorationIndex: evaluated.deteriorationIndex,
        level: evaluated.level,
        isSynthetic: evaluated.isSynthetic,
      },
    });

    return insertedAssessment?.id;
  });

  return {
    ...evaluated,
    riskAssessmentId: assessmentId,
  };
}
