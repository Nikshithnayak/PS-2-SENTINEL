import { applyMigrations, closeDb } from '../src/db/index.ts';
import { ensurePostgresRunning } from '../src/db/local-pg.ts';

async function main() {
  const handle = await ensurePostgresRunning(5433);
  console.log(`[db:migrate] Connected to ${handle.url}`);
  await applyMigrations();
  console.log('[db:migrate] Migrations applied successfully.');
  await closeDb();
  await handle.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
