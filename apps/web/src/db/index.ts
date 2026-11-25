import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeAuditHash } from '@sentinel/shared';
import { desc } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

const { Pool } = pg;

export type AppDb = NodePgDatabase<typeof schema>;

let sharedPool: pg.Pool | null = null;
let sharedDb: AppDb | null = null;

export function getDatabaseUrl(): string {
  return (
    process.env.DATABASE_URL ??
    'postgres://sentinel:sentinel@127.0.0.1:5433/sentinel'
  );
}

export function getPool(): pg.Pool {
  if (!sharedPool) {
    sharedPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: 15,
      idleTimeoutMillis: 30000,
    });
  }
  return sharedPool;
}

export function getDb(): AppDb {
  if (!sharedDb) {
    sharedDb = drizzle(getPool(), { schema });
  }
  return sharedDb;
}

export async function closeDb(): Promise<void> {
  if (sharedPool) {
    await sharedPool.end();
    sharedPool = null;
    sharedDb = null;
  }
}

export async function applyMigrations(pool = getPool()): Promise<void> {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(resolve(__dirname, 'migrations/0001_init.sql'), 'utf8');
  await pool.query(sql);
}

/**
 * Executes queries inside a transaction scoped by PostgreSQL Row-Level Security
 * for the authenticated user ID (`app.current_user_id`).
 */
export async function withUserDb<T>(
  userId: string,
  fn: (tx: AppDb) => Promise<T>,
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE sentinel_app');
    await client.query("SELECT set_config('app.rls_bypass', 'false', true)");
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
    const tx = drizzle(client, { schema });
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Executes queries inside a system transaction (`app.rls_bypass = 'true'`)
 * for auth, migrations, background workers, and seeding.
 */
export async function withSystemDb<T>(fn: (tx: AppDb) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.rls_bypass', 'true', true)");
    const tx = drizzle(client, { schema });
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface AppendAuditParams {
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
}

/**
 * Appends an immutable hash-chained audit record using an advisory transaction lock
 * so concurrent writers never fork `prev_hash`.
 */
export async function appendAuditLog(
  tx: AppDb,
  params: AppendAuditParams,
): Promise<{ seq: number; entryHash: string }> {
  const client = (tx as unknown as { $client?: pg.PoolClient }).$client;
  if (client) {
    await client.query('SELECT pg_advisory_xact_lock(72839104)');
  }

  const latest = await tx
    .select({
      seq: schema.auditLogs.seq,
      entryHash: schema.auditLogs.entryHash,
    })
    .from(schema.auditLogs)
    .orderBy(desc(schema.auditLogs.seq))
    .limit(1);

  const nextSeq = latest[0] ? Number(latest[0].seq) + 1 : 1;
  const prevHash = latest[0] ? latest[0].entryHash : '0'.repeat(64);
  const createdAt = new Date();
  const payloadJson = JSON.stringify(params.payload);
  const entryHash = computeAuditHash({
    seq: nextSeq,
    prevHash,
    actorUserId: params.actorUserId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    payloadJson,
    createdAtIso: createdAt.toISOString(),
  });

  await tx.insert(schema.auditLogs).values({
    seq: nextSeq,
    prevHash,
    entryHash,
    actorUserId: params.actorUserId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    payloadJson,
    createdAt,
  });

  return { seq: nextSeq, entryHash };
}
