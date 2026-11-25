import { spawn } from 'node:child_process';
import { applyMigrations, closeDb } from '../src/db/index.ts';
import { ensurePostgresRunning } from '../src/db/local-pg.ts';
import { seedDatabase } from '../src/db/seed.ts';

async function main() {
  const mode = process.argv[2] ?? 'dev';
  const port = process.env.PORT ?? '3000';
  const pgHandle = await ensurePostgresRunning(5433);
  await applyMigrations();
  await seedDatabase();
  await closeDb();

  const child = spawn(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'next', mode, '--port', port],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: pgHandle.url,
      },
      shell: process.platform === 'win32',
    },
  );

  const shutdown = async () => {
    child.kill('SIGTERM');
    await pgHandle.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  child.on('exit', async (code) => {
    await pgHandle.stop();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
