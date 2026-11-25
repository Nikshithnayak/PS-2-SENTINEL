import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '@sentinel/shared';
import { asc, eq } from 'drizzle-orm';
import { applyMigrations, closeDb, withSystemDb, withUserDb } from '@/db';
import { ensurePostgresRunning, type LocalPgHandle } from '@/db/local-pg';
import { auditLogs, patientProfiles } from '@/db/schema';
import { SEED_IDS, seedDatabase } from '@/db/seed';

let pgHandle: LocalPgHandle;

beforeAll(async () => {
  pgHandle = await ensurePostgresRunning(5434);
  process.env.DATABASE_URL = pgHandle.url;
  await applyMigrations();
  await seedDatabase();
});

afterAll(async () => {
  await closeDb();
  await pgHandle.stop();
});

describe('PostgreSQL RLS, Partitioned Vitals & Append-Only Audit Ledger', () => {
  it('enforces Row-Level Security isolation across patient, consented caregiver, and unlinked user', async () => {
    const patientRows = await withUserDb(SEED_IDS.patientUserId, (tx) =>
      tx.select({ id: patientProfiles.id }).from(patientProfiles),
    );
    expect(patientRows.map((r) => r.id)).toContain(SEED_IDS.patientProfileId);

    const caregiverRows = await withUserDb(SEED_IDS.caregiverUserId, (tx) =>
      tx.select({ id: patientProfiles.id }).from(patientProfiles),
    );
    expect(caregiverRows.map((r) => r.id)).toContain(SEED_IDS.patientProfileId);

    // Unlinked caregiver MUST see zero patient rows under FORCE ROW LEVEL SECURITY
    const unlinkedRows = await withUserDb(SEED_IDS.unlinkedUserId, (tx) =>
      tx.select({ id: patientProfiles.id }).from(patientProfiles),
    );
    expect(unlinkedRows).toHaveLength(0);
  });

  it('prevents UPDATE and DELETE mutations on append-only audit_logs', async () => {
    let updateErr: unknown = null;
    try {
      await withSystemDb((tx) =>
        tx
          .update(auditLogs)
          .set({ action: 'tampered.action' })
          .where(eq(auditLogs.seq, 1)),
      );
    } catch (err) {
      updateErr = err;
    }
    expect(updateErr).not.toBeNull();
    const updateMsg =
      (updateErr as { cause?: { message?: string }; message?: string })?.cause?.message ??
      (updateErr as { message?: string })?.message ??
      '';
    expect(updateMsg).toMatch(/append-only/i);

    let deleteErr: unknown = null;
    try {
      await withSystemDb((tx) => tx.delete(auditLogs).where(eq(auditLogs.seq, 1)));
    } catch (err) {
      deleteErr = err;
    }
    expect(deleteErr).not.toBeNull();
    const deleteMsg =
      (deleteErr as { cause?: { message?: string }; message?: string })?.cause?.message ??
      (deleteErr as { message?: string })?.message ??
      '';
    expect(deleteMsg).toMatch(/append-only/i);
  });

  it('verifies cryptographic hash-chain across seeded audit entries', async () => {
    const rows = await withSystemDb((tx) =>
      tx.select().from(auditLogs).orderBy(asc(auditLogs.seq)),
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const check = verifyAuditChain(
      rows.map((r) => ({
        seq: Number(r.seq),
        prevHash: r.prevHash,
        entryHash: r.entryHash,
        actorUserId: r.actorUserId,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        payloadJson: r.payloadJson,
        createdAtIso: r.createdAt.toISOString(),
      })),
    );
    expect(check).toEqual({ valid: true });
  });
});
