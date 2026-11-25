import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

export interface LocalPgHandle {
  url: string;
  stop: () => Promise<void>;
}

async function canConnect(connectionString: string): Promise<boolean> {
  const client = new Client({ connectionString, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Connects to an external PostgreSQL when reachable, or starts a real local
 * PostgreSQL TCP instance via `embedded-postgres` so Windows dev/CI environments
 * without Docker Desktop execute genuine Postgres SQL, partitions, triggers, and RLS.
 */
export async function ensurePostgresRunning(preferredPort = 5433): Promise<LocalPgHandle> {
  const configuredUrl = process.env.DATABASE_URL;
  if (configuredUrl && (await canConnect(configuredUrl))) {
    return {
      url: configuredUrl,
      stop: async () => {},
    };
  }

  const localUrl = `postgres://sentinel:sentinel@127.0.0.1:${preferredPort}/sentinel`;
  if (await canConnect(localUrl)) {
    process.env.DATABASE_URL = localUrl;
    return {
      url: localUrl,
      stop: async () => {},
    };
  }

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const dataDir = resolve(__dirname, '../../../../.local-pgdata', `port-${preferredPort}`);
  mkdirSync(dataDir, { recursive: true });

  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const pgServer = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'sentinel',
    password: 'sentinel',
    port: preferredPort,
    persistent: true,
    onLog: () => {},
    onError: (err: unknown) => {
      console.error('[embedded-postgres]', err);
    },
  });

  await pgServer.initialise().catch(() => {
    // Already initialized directory
  });
  await pgServer.start();

  // Ensure database `sentinel` exists
  const adminClient = new Client({
    connectionString: `postgres://sentinel:sentinel@127.0.0.1:${preferredPort}/postgres`,
  });
  await adminClient.connect();
  const dbExists = await adminClient.query(
    "SELECT 1 FROM pg_database WHERE datname = 'sentinel'",
  );
  if (dbExists.rowCount === 0) {
    await adminClient.query('CREATE DATABASE sentinel');
  }
  await adminClient.end();

  process.env.DATABASE_URL = localUrl;
  return {
    url: localUrl,
    stop: async () => {
      await pgServer.stop();
    },
  };
}
