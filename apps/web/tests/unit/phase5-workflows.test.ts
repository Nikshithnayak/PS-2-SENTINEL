import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { applyMigrations, closeDb, withSystemDb } from '@/db';
import { ensurePostgresRunning, type LocalPgHandle } from '@/db/local-pg';
import { checkinEvents, excludedPeriods, patientProfiles } from '@/db/schema';
import { SEED_IDS, seedDatabase } from '@/db/seed';
import { loadCohortSummaries, loadPatientDashboard, loadVitalsSeries } from '@/lib/dashboard/queries';
import { ingestVitalBatch } from '@/lib/ingestion/quality';

let pgHandle: LocalPgHandle;

beforeAll(async () => {
  pgHandle = await ensurePostgresRunning(5438);
  process.env.DATABASE_URL = pgHandle.url;
  await applyMigrations();
  await seedDatabase();
});

afterAll(async () => {
  await closeDb();
  await pgHandle?.stop();
});

describe('Phase 5 Multi-Role Queries, Cohort RBAC & Explorer Series', () => {
  it('loads consented patient dashboard, vitals rollups band, check-ins, and restricts unlinked cohort', async () => {
    const now = new Date();
    await ingestVitalBatch({
      patientId: SEED_IDS.patientProfileId,
      source: 'synthetic_sim',
      isSynthetic: true,
      samples: [
        {
          metricType: 'resting_heart_rate',
          value: 66,
          unit: 'bpm',
          recordedAt: new Date(now.getTime() - 2 * 3_600_000).toISOString(),
          context: 'sleep',
          source: 'synthetic_sim',
          isSynthetic: true,
        },
      ],
    });

    await withSystemDb(async (tx) => {
      await tx.insert(checkinEvents).values({
        patientId: SEED_IDS.patientProfileId,
        kind: 'tap_ok',
        locale: 'en',
        symptoms: [],
        severity: 'none',
        isSynthetic: true,
      });
      await tx.insert(excludedPeriods).values({
        patientId: SEED_IDS.patientProfileId,
        startAt: new Date(now.getTime() - 48 * 3_600_000),
        endAt: new Date(now.getTime() - 36 * 3_600_000),
        reason: 'travel',
        note: 'Unit test window',
        createdByUserId: SEED_IDS.patientUserId,
      });
    });

    const dash = await loadPatientDashboard(SEED_IDS.patientProfileId);
    expect(dash?.patientFirstName).toBe('Ramesh');
    expect(dash?.checkins.length).toBeGreaterThanOrEqual(1);
    expect(dash?.exclusions.length).toBeGreaterThanOrEqual(1);

    const series = await loadVitalsSeries({
      patientId: SEED_IDS.patientProfileId,
      metricType: 'resting_heart_rate',
      window: '7d',
    });
    expect(series.points.length).toBeGreaterThanOrEqual(1);

    // Clinician & Caregiver see Ramesh; Unlinked caregiver sees ZERO patients
    const clinicianCohort = await loadCohortSummaries({
      userId: SEED_IDS.clinicianUserId,
      role: 'clinician',
      email: 'dr.shetty@sentinel.local',
      name: 'Dr. Arvind Shetty',
      locale: 'en',
    });
    expect(clinicianCohort.some((c) => c.patientId === SEED_IDS.patientProfileId)).toBe(true);

    const unlinkedCohort = await loadCohortSummaries({
      userId: SEED_IDS.unlinkedUserId,
      role: 'caregiver',
      email: 'unlinked@sentinel.local',
      name: 'Unlinked',
      locale: 'en',
    });
    expect(unlinkedCohort).toEqual([]);

    // Confirm profile clean state
    const [profile] = await withSystemDb((tx) =>
      tx
        .select({ emergencyNumber: patientProfiles.emergencyNumber })
        .from(patientProfiles)
        .where(eq(patientProfiles.id, SEED_IDS.patientProfileId)),
    );
    expect(profile?.emergencyNumber).toBe('112');
  });
});
