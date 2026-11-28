import { and, asc, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { withSystemDb } from '@/db';
import {
  alertDeliveries,
  alerts,
  baselineStates,
  checkinEvents,
  consentGrants,
  detectorDecisionLogs,
  environmentSnapshots,
  excludedPeriods,
  medicationEvents,
  medications,
  patientProfiles,
  riskAssessments,
  user,
  vitalRollupsHourly,
  vitalSamples,
} from '@/db/schema';
import { findNearbyHospitals } from '@/lib/alerts/emergency';
import { evaluateDeviceSilence } from '@/lib/ingestion/quality';
import type { SessionContext } from '@/lib/session';

export async function getAccessiblePatientIds(ctx: SessionContext): Promise<string[]> {
  return withSystemDb(async (tx) => {
    const own = await tx
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(and(eq(patientProfiles.userId, ctx.userId), isNull(patientProfiles.deletedAt)));

    const grants = await tx
      .select({ patientId: consentGrants.patientId })
      .from(consentGrants)
      .where(and(eq(consentGrants.granteeUserId, ctx.userId), isNull(consentGrants.withdrawnAt)));

    const ids = new Set<string>();
    for (const r of own) ids.add(r.id);
    for (const g of grants) ids.add(g.patientId);
    return [...ids];
  });
}

export async function loadPatientDashboard(patientId: string) {
  const [data, silence] = await Promise.all([
    withSystemDb(async (tx) => {
      const [profileRow] = await tx
        .select({
          profile: patientProfiles,
          ownerName: user.name,
        })
        .from(patientProfiles)
        .innerJoin(user, eq(patientProfiles.userId, user.id))
        .where(eq(patientProfiles.id, patientId))
        .limit(1);

      if (!profileRow) return null;

      const latestAssessments = await tx
        .select()
        .from(riskAssessments)
        .where(eq(riskAssessments.patientId, patientId))
        .orderBy(desc(riskAssessments.assessedAt))
        .limit(2);

      const timelineAssessments = await tx
        .select({
          id: riskAssessments.id,
          assessedAt: riskAssessments.assessedAt,
          deteriorationIndex: riskAssessments.deteriorationIndex,
          level: riskAssessments.level,
          l1Score: riskAssessments.l1Score,
          l2Score: riskAssessments.l2Score,
          l3Score: riskAssessments.l3Score,
          contributions: riskAssessments.contributions,
          explanationEn: riskAssessments.explanationEn,
        })
        .from(riskAssessments)
        .where(eq(riskAssessments.patientId, patientId))
        .orderBy(asc(riskAssessments.assessedAt))
        .limit(60);

      const timelineDecisionLogs = await tx
        .select({
          assessedAt: detectorDecisionLogs.assessedAt,
          decisionPayload: detectorDecisionLogs.decisionPayload,
        })
        .from(detectorDecisionLogs)
        .where(eq(detectorDecisionLogs.patientId, patientId))
        .orderBy(asc(detectorDecisionLogs.assessedAt))
        .limit(30);

      const baselines = await tx
        .select()
        .from(baselineStates)
        .where(eq(baselineStates.patientId, patientId))
        .orderBy(desc(baselineStates.validDays));

      const alertList = await tx
        .select()
        .from(alerts)
        .where(eq(alerts.patientId, patientId))
        .orderBy(desc(alerts.createdAt))
        .limit(15);

      const deliveries = await tx
        .select()
        .from(alertDeliveries)
        .where(eq(alertDeliveries.patientId, patientId))
        .orderBy(desc(alertDeliveries.createdAt))
        .limit(20);

      const checkins = await tx
        .select()
        .from(checkinEvents)
        .where(eq(checkinEvents.patientId, patientId))
        .orderBy(desc(checkinEvents.recordedAt))
        .limit(10);

      const meds = await tx
        .select()
        .from(medications)
        .where(and(eq(medications.patientId, patientId), eq(medications.active, true)));

      const exclusions = await tx
        .select()
        .from(excludedPeriods)
        .where(eq(excludedPeriods.patientId, patientId))
        .orderBy(desc(excludedPeriods.startAt))
        .limit(10);

      const [env] = await tx
        .select()
        .from(environmentSnapshots)
        .orderBy(desc(environmentSnapshots.fetchedAt))
        .limit(1);

      const syntheticCheck = await tx
        .select({ id: vitalSamples.id })
        .from(vitalSamples)
        .where(and(eq(vitalSamples.patientId, patientId), eq(vitalSamples.isSynthetic, true)))
        .limit(1);

      const timelineRows = timelineAssessments.map((a) => {
        const layers: string[] = [];
        if (a.l1Score >= 20) layers.push('L1 Safety');
        if (a.l2Score >= 20) layers.push('L2 Personal Temporal');
        if (a.l3Score >= 20) layers.push('L3 Multivariate');
        const topContrib = Array.isArray(a.contributions)
          ? (a.contributions[0] as { label?: unknown } | undefined)
          : undefined;
        return {
          ...a,
          layers,
          metric: typeof topContrib?.label === 'string' ? topContrib.label : 'Multi-signal pattern',
        };
      });

      const recordedChangePoints = timelineDecisionLogs
        .flatMap((d) => {
          const payload = d.decisionPayload as { changePoints?: string[] } | null;
          return payload?.changePoints ?? [];
        })
        .filter((s) => typeof s === 'string' && !Number.isNaN(Date.parse(s)))
        .sort();

      const firstElevated = timelineRows.find((r) => r.level !== 'stable' || r.deteriorationIndex >= 30);
      const firstAlertAsc = [...alertList].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      )[0];
      const firstDetectionAt =
        firstElevated?.assessedAt.toISOString() ??
        recordedChangePoints[0] ??
        firstAlertAsc?.createdAt.toISOString() ??
        null;

      const recoveredRow = firstDetectionAt
        ? timelineRows.find(
            (r) =>
              r.assessedAt.getTime() > Date.parse(firstDetectionAt) &&
              r.level === 'stable' &&
              r.deteriorationIndex < 30,
          )
        : null;

      const phase: 'baseline_only' | 'first_detection' | 'confirmed_alert' | 'recovered' = recoveredRow
        ? 'recovered'
        : firstAlertAsc
          ? 'confirmed_alert'
          : firstDetectionAt
            ? 'first_detection'
            : 'baseline_only';

      const events: Array<{
        timestamp: string;
        stage: 'baseline' | 'first_detection' | 'confirmed_alert' | 'monitoring' | 'recovered';
        level: string;
        index: number;
        metric: string;
        layers: string[];
        reason: string;
        alertStatus?: string;
      }> = [];

      if (timelineRows[0]) {
        const firstRow = timelineRows[0];
        if (firstRow.level === 'stable' && firstRow.deteriorationIndex < 30) {
          events.push({
            timestamp: firstRow.assessedAt.toISOString(),
            stage: 'baseline',
            level: firstRow.level,
            index: firstRow.deteriorationIndex,
            metric: firstRow.metric,
            layers: firstRow.layers,
            reason: firstRow.explanationEn,
          });
        }
      }
      if (firstElevated) {
        events.push({
          timestamp: firstElevated.assessedAt.toISOString(),
          stage: 'first_detection',
          level: firstElevated.level,
          index: firstElevated.deteriorationIndex,
          metric: firstElevated.metric,
          layers: firstElevated.layers,
          reason: firstElevated.explanationEn,
        });
      }
      if (firstAlertAsc) {
        events.push({
          timestamp: firstAlertAsc.createdAt.toISOString(),
          stage: 'confirmed_alert',
          level: firstAlertAsc.level,
          index: latestAssessments[0]?.deteriorationIndex ?? firstElevated?.deteriorationIndex ?? 0,
          metric: firstElevated?.metric ?? 'Multi-signal pattern',
          layers: firstElevated?.layers ?? [],
          reason: firstAlertAsc.summaryEn,
          alertStatus: firstAlertAsc.status,
        });
      }
      if (recoveredRow) {
        events.push({
          timestamp: recoveredRow.assessedAt.toISOString(),
          stage: 'recovered',
          level: recoveredRow.level,
          index: recoveredRow.deteriorationIndex,
          metric: recoveredRow.metric,
          layers: recoveredRow.layers,
          reason: recoveredRow.explanationEn,
        });
      }
      events.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

      const detectionTimeline = {
        phase,
        firstDetectionAt,
        firstDetectionMetric: firstElevated?.metric ?? null,
        contributingLayers: firstElevated?.layers ?? [],
        firstDetectionReason: firstElevated?.explanationEn ?? null,
        confirmedAlertAt: firstAlertAsc?.createdAt.toISOString() ?? null,
        confirmedAlertLevel: firstAlertAsc?.level ?? null,
        recoveredAt: recoveredRow?.assessedAt.toISOString() ?? null,
        latestIndex: latestAssessments[0]?.deteriorationIndex ?? 0,
        latestLevel: latestAssessments[0]?.level ?? 'stable',
        events,
      };

      return {
        profile: profileRow.profile,
        patientFirstName: profileRow.ownerName.split(' ')[0] ?? profileRow.profile.displayCode,
        patientFullName: profileRow.ownerName,
        latestAssessment: latestAssessments[0] ?? null,
        detectionTimeline,
        baselines,
        alerts: alertList,
        deliveries,
        checkins,
        meds,
        exclusions,
        environment: env ?? null,
        hasSyntheticSamples: syntheticCheck.length > 0,
      };
    }),
    evaluateDeviceSilence(patientId),
  ]);

  if (!data) return null;
  const hospitals = await findNearbyHospitals(
    data.profile.regionLat ?? 12.91,
    data.profile.regionLon ?? 74.86,
    data.profile.city ?? 'Mangaluru',
  );

  return {
    patientId,
    displayCode: data.profile.displayCode,
    patientName: data.patientFullName,
    patientFirstName: data.patientFirstName,
    ageBand: data.profile.ageBand,
    conditionModules: data.profile.conditionModules,
    locale: data.profile.locale,
    emergencyNumber: data.profile.emergencyNumber,
    ambulanceNumber: data.profile.ambulanceNumber,
    city: data.profile.city ?? 'Mangaluru',
    quietHoursStart: data.profile.quietHoursStart,
    quietHoursEnd: data.profile.quietHoursEnd,
    dailyAlertBudget: data.profile.dailyAlertBudget,
    sensitivityOffset: data.profile.sensitivityOffset,
    silentAlertHours: data.profile.silentAlertHours,
    isSynthetic: data.hasSyntheticSamples || Boolean(data.latestAssessment?.isSynthetic),
    silence,
    latestAssessment: data.latestAssessment,
    detectionTimeline: data.detectionTimeline,
    baselines: data.baselines,
    alerts: data.alerts,
    deliveries: data.deliveries,
    checkins: data.checkins,
    medications: data.meds,
    exclusions: data.exclusions,
    environment: data.environment,
    hospitals: hospitals.slice(0, 3),
  };
}

export async function loadCohortSummaries(ctx: SessionContext) {
  const accessibleIds = await getAccessiblePatientIds(ctx);
  if (accessibleIds.length === 0) return [];

  return withSystemDb(async (tx) => {
    const profiles = await tx
      .select({
        profile: patientProfiles,
        name: user.name,
      })
      .from(patientProfiles)
      .innerJoin(user, eq(patientProfiles.userId, user.id))
      .where(and(inArray(patientProfiles.id, accessibleIds), isNull(patientProfiles.deletedAt)));

    const results = [];
    for (const row of profiles) {
      const pid = row.profile.id;
      const [latestRisk] = await tx
        .select()
        .from(riskAssessments)
        .where(eq(riskAssessments.patientId, pid))
        .orderBy(desc(riskAssessments.assessedAt))
        .limit(1);

      const [bl] = await tx
        .select()
        .from(baselineStates)
        .where(eq(baselineStates.patientId, pid))
        .orderBy(desc(baselineStates.validDays))
        .limit(1);

      const openAlerts = await tx
        .select({ id: alerts.id })
        .from(alerts)
        .where(and(eq(alerts.patientId, pid), inArray(alerts.status, ['open', 'escalated'])));

      results.push({
        patientId: pid,
        displayCode: row.profile.displayCode,
        patientName: row.name,
        ageBand: row.profile.ageBand,
        conditionModules: row.profile.conditionModules,
        deteriorationIndex: latestRisk?.deteriorationIndex ?? 0,
        level: latestRisk?.level ?? 'stable',
        assessedAt: latestRisk?.assessedAt?.toISOString() ?? null,
        baselineStage: bl?.status ?? 'warming_prior',
        validDays: bl?.validDays ?? 0,
        openAlertCount: openAlerts.length,
        isSynthetic: Boolean(latestRisk?.isSynthetic || row.profile.isSynthetic),
      });
    }

    return results.sort((a, b) => b.deteriorationIndex - a.deteriorationIndex);
  });
}

export async function loadVitalsSeries(params: {
  patientId: string;
  metricType: string;
  window: '24h' | '7d' | '30d';
}) {
  const hours = params.window === '24h' ? 24 : params.window === '7d' ? 168 : 720;
  const now = new Date();
  const since = new Date(now.getTime() - hours * 3_600_000);
  const prevSince = new Date(since.getTime() - hours * 3_600_000);

  return withSystemDb(async (tx) => {
    let resolvedMetric = params.metricType;
    let rollups = await tx
      .select()
      .from(vitalRollupsHourly)
      .where(
        and(
          eq(vitalRollupsHourly.patientId, params.patientId),
          eq(vitalRollupsHourly.metricType, params.metricType),
          gte(vitalRollupsHourly.bucketStart, since),
        ),
      )
      .orderBy(asc(vitalRollupsHourly.bucketStart));

    // When a wearer syncs only optical/BLE `heart_rate` (e.g., Google Fit or Web BLE 0x180D)
    // and has zero explicit `resting_heart_rate` rows, backfill from calm heart_rate first,
    // and if only daytime/activity heart_rate rollups exist in the window, show all heart_rate rollups.
    if (rollups.length === 0 && params.metricType === 'resting_heart_rate') {
      const calmHrRollups = await tx
        .select()
        .from(vitalRollupsHourly)
        .where(
          and(
            eq(vitalRollupsHourly.patientId, params.patientId),
            eq(vitalRollupsHourly.metricType, 'heart_rate'),
            inArray(vitalRollupsHourly.context, ['sleep', 'rest', 'unknown']),
            gte(vitalRollupsHourly.bucketStart, since),
          ),
        )
        .orderBy(asc(vitalRollupsHourly.bucketStart));
      if (calmHrRollups.length > 0) {
        rollups = calmHrRollups;
        resolvedMetric = 'heart_rate';
      } else {
        const anyHrRollups = await tx
          .select()
          .from(vitalRollupsHourly)
          .where(
            and(
              eq(vitalRollupsHourly.patientId, params.patientId),
              eq(vitalRollupsHourly.metricType, 'heart_rate'),
              gte(vitalRollupsHourly.bucketStart, since),
            ),
          )
          .orderBy(asc(vitalRollupsHourly.bucketStart));
        if (anyHrRollups.length > 0) {
          rollups = anyHrRollups;
          resolvedMetric = 'heart_rate';
        }
      }
    }

    let latestAvailableAt: string | null = null;
    if (rollups.length === 0) {
      const targetMetrics =
        params.metricType === 'resting_heart_rate'
          ? ['resting_heart_rate', 'heart_rate']
          : [params.metricType];
      const [latestAny] = await tx
        .select({ bucketStart: vitalRollupsHourly.bucketStart })
        .from(vitalRollupsHourly)
        .where(
          and(
            eq(vitalRollupsHourly.patientId, params.patientId),
            inArray(vitalRollupsHourly.metricType, targetMetrics),
          ),
        )
        .orderBy(desc(vitalRollupsHourly.bucketStart))
        .limit(1);
      latestAvailableAt = latestAny?.bucketStart?.toISOString() ?? null;
    }

    const prevRollups = await tx
      .select({ medianVal: vitalRollupsHourly.medianVal })
      .from(vitalRollupsHourly)
      .where(
        and(
          eq(vitalRollupsHourly.patientId, params.patientId),
          eq(vitalRollupsHourly.metricType, resolvedMetric),
          ...(resolvedMetric === 'heart_rate' && params.metricType === 'resting_heart_rate'
            ? [inArray(vitalRollupsHourly.context, ['sleep', 'rest', 'unknown'])]
            : []),
          gte(vitalRollupsHourly.bucketStart, prevSince),
        ),
      );

    const prevValues = prevRollups.map((r) => r.medianVal);
    const curValues = rollups.map((r) => r.medianVal);
    const avg = (xs: number[]) =>
      xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)) : null;

    let [baseline] = await tx
      .select()
      .from(baselineStates)
      .where(
        and(
          eq(baselineStates.patientId, params.patientId),
          eq(baselineStates.metricType, params.metricType),
        ),
      )
      .limit(1);

    if (!baseline && resolvedMetric !== params.metricType) {
      [baseline] = await tx
        .select()
        .from(baselineStates)
        .where(
          and(
            eq(baselineStates.patientId, params.patientId),
            eq(baselineStates.metricType, resolvedMetric),
          ),
        )
        .limit(1);
    }

    const recentAlerts = await tx
      .select()
      .from(alerts)
      .where(and(eq(alerts.patientId, params.patientId), gte(alerts.createdAt, since)))
      .orderBy(asc(alerts.createdAt));

    const decisionLogs = await tx
      .select()
      .from(detectorDecisionLogs)
      .where(
        and(
          eq(detectorDecisionLogs.patientId, params.patientId),
          gte(detectorDecisionLogs.assessedAt, since),
        ),
      )
      .orderBy(desc(detectorDecisionLogs.assessedAt))
      .limit(1);

    const rawRecent = await tx
      .select()
      .from(vitalSamples)
      .where(
        and(
          eq(vitalSamples.patientId, params.patientId),
          eq(vitalSamples.metricType, resolvedMetric),
          ...(resolvedMetric === 'heart_rate' && params.metricType === 'resting_heart_rate'
            ? [inArray(vitalSamples.context, ['sleep', 'rest', 'unknown'])]
            : []),
          gte(vitalSamples.recordedAt, since),
        ),
      )
      .orderBy(desc(vitalSamples.recordedAt))
      .limit(60);

    const medEvents = await tx
      .select({
        id: medicationEvents.id,
        status: medicationEvents.status,
        recordedAt: medicationEvents.recordedAt,
        medName: medications.name,
      })
      .from(medicationEvents)
      .innerJoin(medications, eq(medicationEvents.medicationId, medications.id))
      .where(
        and(
          eq(medicationEvents.patientId, params.patientId),
          gte(medicationEvents.recordedAt, since),
        ),
      )
      .orderBy(asc(medicationEvents.recordedAt));

    const changePoints = ((decisionLogs[0]?.decisionPayload as { changePoints?: string[] })?.changePoints ?? []);

    const sigma = baseline ? Math.max(0.5, 1.4826 * baseline.madVal) : null;
    const bandLow = baseline && sigma ? Number((baseline.medianVal - 1.6 * sigma).toFixed(2)) : null;
    const bandHigh = baseline && sigma ? Number((baseline.medianVal + 1.6 * sigma).toFixed(2)) : null;

    return {
      patientId: params.patientId,
      metricType: params.metricType,
      effectiveMetricType: resolvedMetric,
      window: params.window,
      hasOlderSamples: Boolean(rollups.length === 0 && latestAvailableAt),
      latestAvailableAt,
      baseline: baseline
        ? {
            stage: baseline.status,
            validDays: baseline.validDays,
            medianVal: Number(baseline.medianVal.toFixed(2)),
            bandLow,
            bandHigh,
          }
        : null,
      comparison: {
        currentMean: avg(curValues),
        previousWindowMean: avg(prevValues),
      },
      points: rollups.map((r) => ({
        timestamp: r.bucketStart.toISOString(),
        value: Number(r.medianVal.toFixed(2)),
        minVal: Number(r.minVal.toFixed(2)),
        maxVal: Number(r.maxVal.toFixed(2)),
        confidence: r.confidence,
        context: r.context,
        isSynthetic: r.isSynthetic,
      })),
      changePoints,
      alertMarkers: recentAlerts.map((a) => ({
        id: a.id,
        timestamp: a.createdAt.toISOString(),
        level: a.level,
        status: a.status,
      })),
      medMarkers: medEvents.map((m) => ({
        id: m.id,
        timestamp: m.recordedAt.toISOString(),
        medName: m.medName,
        status: m.status,
      })),
      recentRawSamples: rawRecent.map((s) => ({
        id: s.id,
        recordedAt: s.recordedAt.toISOString(),
        value: s.value,
        unit: s.unit,
        context: s.context,
        source: s.source,
        qualityFlags: s.qualityFlags,
        dataConfidence: s.dataConfidence,
        isSynthetic: s.isSynthetic,
      })),
    };
  });
}
