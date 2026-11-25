import { applyMigrations, closeDb } from '../src/db/index.ts';
import { ensurePostgresRunning } from '../src/db/local-pg.ts';
import { seedDatabase } from '../src/db/seed.ts';

async function main() {
  const handle = await ensurePostgresRunning(5433);
  await applyMigrations();
  const res = await seedDatabase();
  console.log(`[db:seed] Seed completed (seeded=${res.seeded}).`);
  await closeDb();
  await handle.stop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
