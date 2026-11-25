import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { applyMigrations, closeDb, withSystemDb } from '@/db';
import { ensurePostgresRunning, type LocalPgHandle } from '@/db/local-pg';
import {
  baselineStates,
  detectorDecisionLogs,
  excludedPeriods,
  ingestBatches,
  riskAssessments,
  vitalRollupsHourly,
  vitalSamples,
} from '@/db/schema';
import { SEED_IDS, seedDatabase } from '@/db/seed';
import { runAndPersistEvaluation } from '@/lib/engine/client';
import { ingestVitalBatch } from '@/lib/ingestion/quality';

let pgHandle: LocalPgHandle;

beforeAll(async () => {
  pgHandle = await ensurePostgresRunning(5436);
  process.env.DATABASE_URL = pgHandle.url;
  await applyMigrations();
  await seedDatabase();
  await withSystemDb(async (tx) => {
    await tx.delete(baselineStates).where(eq(baselineStates.patientId, SEED_IDS.patientProfileId));
    await tx.delete(riskAssessments).where(eq(riskAssessments.patientId, SEED_IDS.patientProfileId));
    await tx
      .delete(detectorDecisionLogs)
      .where(eq(detectorDecisionLogs.patientId, SEED_IDS.patientProfileId));
    await tx
      .delete(excludedPeriods)
      .where(eq(excludedPeriods.patientId, SEED_IDS.patientProfileId));
    await tx
      .delete(vitalRollupsHourly)
      .where(eq(vitalRollupsHourly.patientId, SEED_IDS.patientProfileId));
    await tx.delete(vitalSamples).where(eq(vitalSamples.patientId, SEED_IDS.patientProfileId));
    await tx.delete(ingestBatches).where(eq(ingestBatches.patientId, SEED_IDS.patientProfileId));
  });
});

afterAll(async () => {
  await closeDb();
  await pgHandle?.stop();
});

describe('Phase 3 Engine Persistence & Exclusions Bridge', () => {
  it('evaluates vitals, persists baseline_states, risk_assessments, and detector_decision_logs', async () => {
    const now = Date.now();
    const samples = [];
    for (let d = 15; d >= 1; d -= 1) {
      samples.push({
        metricType: 'resting_heart_rate' as const,
        value: 64 + (d % 3),
        unit: 'bpm',
        recordedAt: new Date(now - d * 24 * 3_600_000).toISOString(),
        context: 'sleep' as const,
        source: 'synthetic_sim' as const,
        isSynthetic: true,
      });
      samples.push({
        metricType: 'spo2' as const,
        value: 97,
        unit: '%',
        recordedAt: new Date(now - d * 24 * 3_600_000).toISOString(),
        context: 'sleep' as const,
        source: 'synthetic_sim' as const,
        isSynthetic: true,
      });
    }
    // Current elevated shift
    samples.push({
      metricType: 'resting_heart_rate' as const,
      value: 92,
      unit: 'bpm',
      recordedAt: new Date(now - 30 * 60_000).toISOString(),
      context: 'rest' as const,
      source: 'synthetic_sim' as const,
      isSynthetic: true,
    });

    await ingestVitalBatch({
      patientId: SEED_IDS.patientProfileId,
      source: 'synthetic_sim',
      samples,
      isSynthetic: true,
    });

    const evalRes = await runAndPersistEvaluation({
      patientId: SEED_IDS.patientProfileId,
      actorUserId: SEED_IDS.patientUserId,
    });

    expect(evalRes.deteriorationIndex).toBeGreaterThanOrEqual(30);
    expect(evalRes.isSynthetic).toBe(true);
    expect(evalRes.explanationKn.length).toBeGreaterThan(10);
    expect(evalRes.explanationHi.length).toBeGreaterThan(10);

    const dbState = await withSystemDb(async (tx) => {
      const bl = await tx
        .select()
        .from(baselineStates)
        .where(eq(baselineStates.patientId, SEED_IDS.patientProfileId));
      const ra = await tx
        .select()
        .from(riskAssessments)
        .where(eq(riskAssessments.patientId, SEED_IDS.patientProfileId));
      const dl = await tx
        .select()
        .from(detectorDecisionLogs)
        .where(eq(detectorDecisionLogs.patientId, SEED_IDS.patientProfileId));
      return { bl, ra, dl };
    });

    expect(dbState.bl.length).toBeGreaterThanOrEqual(1);
    expect(dbState.ra.length).toBe(1);
    expect(dbState.dl.length).toBe(1);
  });
});
