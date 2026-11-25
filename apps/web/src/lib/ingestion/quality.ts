import {
  computeSampleHash,
  isWithinPhysicalBounds,
  normalizeToCanonicalUnit,
  type ActivityContext,
  type MetricType,
  type ProviderSource,
  type QualityFlag,
  type VitalSampleInput,
} from '@sentinel/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { appendAuditLog, withSystemDb } from '@/db';
import { ingestBatches, patientProfiles, vitalRollupsHourly, vitalSamples } from '@/db/schema';

export interface ProcessedBatchResult {
  batchId: string;
  deduplicatedBatch: boolean;
  recordsReceived: number;
  recordsAccepted: number;
  recordsSkipped: number;
  skipReasons: Record<string, number>;
  motionFlaggedCount: number;
  isSynthetic: boolean;
}

const MOTION_SENSITIVE_METRICS = new Set<MetricType>([
  'resting_heart_rate',
  'hrv_rmssd',
  'spo2',
  'respiratory_rate',
]);

function bucketHour(date: Date): Date {
  const d = new Date(date.getTime());
  d.setUTCMinutes(0, 0, 0);
  return d;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? 0;
}

/**
 * Normalizes units, checks physical bounds, flags motion artifacts using concurrent
 * step bursts, deduplicates samples, writes partitioned `vital_samples`, and updates
 * `vital_rollups_hourly`.
 */
export async function ingestVitalBatch(params: {
  patientId: string;
  source: ProviderSource;
  samples: VitalSampleInput[];
  idempotencyKey?: string;
  actorUserId?: string | null;
  isSynthetic?: boolean;
}): Promise<ProcessedBatchResult> {
  const { patientId, source, samples, idempotencyKey, actorUserId = null } = params;
  const isSyntheticBatch = Boolean(params.isSynthetic || samples.some((s) => s.isSynthetic));

  return withSystemDb(async (tx) => {
    if (idempotencyKey) {
      const existingBatch = await tx
        .select()
        .from(ingestBatches)
        .where(
          and(
            eq(ingestBatches.patientId, patientId),
            eq(ingestBatches.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);

      if (existingBatch[0]) {
        const b = existingBatch[0];
        return {
          batchId: b.id,
          deduplicatedBatch: true,
          recordsReceived: b.recordsReceived,
          recordsAccepted: b.recordsAccepted,
          recordsSkipped: b.recordsSkipped,
          skipReasons: b.skipReasons,
          motionFlaggedCount: 0,
          isSynthetic: b.isSynthetic,
        };
      }
    }

    // Track 5-minute windows with high step counts to detect optical PPG motion artifacts
    const highMotionWindows = new Set<string>();
    for (const s of samples) {
      if (s.metricType === 'steps' && s.value >= 35) {
        const d = new Date(s.recordedAt);
        if (!Number.isNaN(d.getTime())) {
          const slot = Math.floor(d.getTime() / (5 * 60_000));
          highMotionWindows.add(String(slot));
        }
      }
    }

    const skipReasons: Record<string, number> = {};
    const addSkip = (reason: string) => {
      skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
    };

    const preparedRows: Array<{
      patientId: string;
      metricType: MetricType;
      value: number;
      unit: string;
      recordedAt: Date;
      windowSeconds: number;
      context: ActivityContext;
      source: ProviderSource;
      deviceModel: string | null;
      sourceHash: string;
      qualityFlags: QualityFlag[];
      dataConfidence: number;
      isSynthetic: boolean;
    }> = [];

    let motionFlaggedCount = 0;

    for (const sample of samples) {
      const recordedDate = new Date(sample.recordedAt);
      if (Number.isNaN(recordedDate.getTime())) {
        addSkip('invalid_timestamp');
        continue;
      }

      const norm = normalizeToCanonicalUnit(sample.metricType, sample.value, sample.unit);
      if (!isWithinPhysicalBounds(sample.metricType, norm.value)) {
        addSkip(`out_of_bounds:${sample.metricType}`);
        continue;
      }

      const flags: QualityFlag[] = [];
      let confidence = 1.0;

      if (norm.converted) {
        flags.push('unit_converted');
      }

      const slot = String(Math.floor(recordedDate.getTime() / (5 * 60_000)));
      const hasMotion =
        sample.context === 'exercise' ||
        (MOTION_SENSITIVE_METRICS.has(sample.metricType) && highMotionWindows.has(slot));

      if (hasMotion && MOTION_SENSITIVE_METRICS.has(sample.metricType)) {
        flags.push('motion_artifact');
        confidence = 0.35;
        motionFlaggedCount += 1;
      } else if (sample.metricType === 'spo2') {
        // Wrist PPG SpO2 carries inherent baseline uncertainty (skin tone / perfusion)
        confidence = sample.context === 'sleep' ? 0.85 : 0.7;
      }

      if (flags.length === 0) {
        flags.push('ok');
      }

      const isoUtc = recordedDate.toISOString();
      const sourceHash = computeSampleHash(
        patientId,
        sample.metricType,
        isoUtc,
        sample.source ?? source,
        norm.value,
      );

      preparedRows.push({
        patientId,
        metricType: sample.metricType,
        value: norm.value,
        unit: norm.unit,
        recordedAt: recordedDate,
        windowSeconds: sample.windowSeconds ?? 60,
        context: sample.context,
        source: sample.source ?? source,
        deviceModel: sample.deviceModel ?? null,
        sourceHash,
        qualityFlags: flags,
        dataConfidence: confidence,
        isSynthetic: Boolean(isSyntheticBatch || sample.isSynthetic),
      });
    }

    const batchInserted = await tx
      .insert(ingestBatches)
      .values({
        patientId,
        source,
        idempotencyKey: idempotencyKey ?? null,
        recordsReceived: samples.length,
        recordsAccepted: preparedRows.length,
        recordsSkipped: samples.length - preparedRows.length,
        skipReasons,
        isSynthetic: isSyntheticBatch,
      })
      .returning();

    const batch = batchInserted[0]!;

    // Chunked insert with ON CONFLICT DO NOTHING on (patient_id, metric_type, recorded_at, source_hash)
    const CHUNK = 400;
    for (let i = 0; i < preparedRows.length; i += CHUNK) {
      const slice = preparedRows.slice(i, i + CHUNK).map((r) => ({
        ...r,
        batchId: batch.id,
      }));
      await tx.insert(vitalSamples).values(slice).onConflictDoNothing();
    }

    // Recompute affected hourly rollups from prepared samples
    const rollupGroups = new Map<
      string,
      {
        patientId: string;
        bucketStart: Date;
        metricType: string;
        context: string;
        values: number[];
        confidences: number[];
        isSynthetic: boolean;
      }
    >();

    for (const r of preparedRows) {
      const bucketStart = bucketHour(r.recordedAt);
      const key = `${bucketStart.toISOString()}|${r.metricType}|${r.context}`;
      const grp = rollupGroups.get(key) ?? {
        patientId,
        bucketStart,
        metricType: r.metricType,
        context: r.context,
        values: [],
        confidences: [],
        isSynthetic: r.isSynthetic,
      };
      grp.values.push(r.value);
      grp.confidences.push(r.dataConfidence);
      rollupGroups.set(key, grp);
    }

    const rollupRows = Array.from(rollupGroups.values()).map((g) => {
      const sum = g.values.reduce((acc, v) => acc + v, 0);
      const avgConf = g.confidences.reduce((acc, c) => acc + c, 0) / g.confidences.length;
      return {
        patientId: g.patientId,
        bucketStart: g.bucketStart,
        metricType: g.metricType,
        context: g.context,
        sampleCount: g.values.length,
        meanVal: Number((sum / g.values.length).toFixed(3)),
        medianVal: Number(median(g.values).toFixed(3)),
        minVal: Math.min(...g.values),
        maxVal: Math.max(...g.values),
        wearFraction: Number(Math.min(1, g.values.length / 4).toFixed(2)),
        confidence: Number(avgConf.toFixed(2)),
        isSynthetic: g.isSynthetic,
      };
    });

    for (let i = 0; i < rollupRows.length; i += CHUNK) {
      const slice = rollupRows.slice(i, i + CHUNK);
      await tx
        .insert(vitalRollupsHourly)
        .values(slice)
        .onConflictDoUpdate({
          target: [
            vitalRollupsHourly.patientId,
            vitalRollupsHourly.bucketStart,
            vitalRollupsHourly.metricType,
            vitalRollupsHourly.context,
          ],
          set: {
            sampleCount: sql`excluded.sample_count`,
            meanVal: sql`excluded.mean_val`,
            medianVal: sql`excluded.median_val`,
            minVal: sql`excluded.min_val`,
            maxVal: sql`excluded.max_val`,
            wearFraction: sql`excluded.wear_fraction`,
            confidence: sql`excluded.confidence`,
            isSynthetic: sql`excluded.is_synthetic`,
          },
        });
    }

    await appendAuditLog(tx, {
      actorUserId,
      action: 'ingest.batch',
      targetType: 'ingest_batch',
      targetId: batch.id,
      payload: {
        patientId,
        source,
        received: samples.length,
        accepted: preparedRows.length,
        skipped: samples.length - preparedRows.length,
        isSynthetic: isSyntheticBatch,
      },
    });

    return {
      batchId: batch.id,
      deduplicatedBatch: false,
      recordsReceived: samples.length,
      recordsAccepted: preparedRows.length,
      recordsSkipped: samples.length - preparedRows.length,
      skipReasons,
      motionFlaggedCount,
      isSynthetic: isSyntheticBatch,
    };
  });
}

export interface DeviceSilenceStatus {
  patientId: string;
  lastRecordedAt: string | null;
  hoursSilent: number | null;
  thresholdHours: number;
  isSilent: boolean;
  wearRatio7d: number;
}

export async function evaluateDeviceSilence(
  patientId: string,
  now = new Date(),
): Promise<DeviceSilenceStatus> {
  return withSystemDb(async (tx) => {
    const profile = await tx
      .select({ silentAlertHours: patientProfiles.silentAlertHours })
      .from(patientProfiles)
      .where(eq(patientProfiles.id, patientId))
      .limit(1);

    const thresholdHours = profile[0]?.silentAlertHours ?? 12;

    const latest = await tx
      .select({ recordedAt: vitalSamples.recordedAt })
      .from(vitalSamples)
      .where(eq(vitalSamples.patientId, patientId))
      .orderBy(desc(vitalSamples.recordedAt))
      .limit(1);

    if (!latest[0]) {
      return {
        patientId,
        lastRecordedAt: null,
        hoursSilent: null,
        thresholdHours,
        isSilent: false,
        wearRatio7d: 0,
      };
    }

    const diffHours = Number(
      ((now.getTime() - latest[0].recordedAt.getTime()) / 3_600_000).toFixed(1),
    );

    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
    const activeHoursRes = await tx
      .select({
        cnt: sql<number>`count(distinct date_trunc('hour', ${vitalSamples.recordedAt}))::int`,
      })
      .from(vitalSamples)
      .where(
        and(
          eq(vitalSamples.patientId, patientId),
          sql`${vitalSamples.recordedAt} >= ${sevenDaysAgo.toISOString()}::timestamptz`,
        ),
      );

    const activeHours = Number(activeHoursRes[0]?.cnt ?? 0);
    const wearRatio7d = Number(Math.min(1, activeHours / (7 * 24)).toFixed(2));

    return {
      patientId,
      lastRecordedAt: latest[0].recordedAt.toISOString(),
      hoursSilent: Math.max(0, diffHours),
      thresholdHours,
      isSilent: diffHours >= thresholdHours,
      wearRatio7d,
    };
  });
}
