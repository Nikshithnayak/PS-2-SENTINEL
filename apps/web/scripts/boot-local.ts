import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyMigrations, closeDb } from '../src/db/index.ts';
import { ensurePostgresRunning } from '../src/db/local-pg.ts';
import { seedDatabase } from '../src/db/seed.ts';

function loadOptionalEnvFiles() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(__dirname, '../../../.env'),
    resolve(__dirname, '../../../.env.local'),
    resolve(__dirname, '../.env'),
    resolve(__dirname, '../.env.local'),
  ];
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined && val.length > 0) {
        process.env[key] = val;
      }
    }
  }
}

async function isEngineHealthy(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1200) });
    return res.ok;
  } catch {
    return false;
  }
}

async function maybeStartPythonEngine(engineUrl: string): Promise<ChildProcess | null> {
  if (await isEngineHealthy(engineUrl)) {
    return null;
  }
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const engineDir = resolve(__dirname, '../../../services/engine');
  const venvPy =
    process.platform === 'win32'
      ? resolve(engineDir, '.venv/Scripts/python.exe')
      : resolve(engineDir, '.venv/bin/python');

  if (!existsSync(venvPy)) {
    return null;
  }

  const pyProc = spawn(
    venvPy,
    ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000'],
    {
      cwd: engineDir,
      stdio: 'ignore',
      env: process.env,
    },
  );

  for (let i = 0; i < 40; i += 1) {
    if (await isEngineHealthy(engineUrl)) {
      return pyProc;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return pyProc;
}

async function main() {
  loadOptionalEnvFiles();
  const mode = process.argv[2] ?? 'dev';
  const port = process.env.PORT ?? '3000';
  const engineUrl = process.env.ENGINE_URL ?? 'http://127.0.0.1:8000';

  const pgHandle = await ensurePostgresRunning(5433);
  await applyMigrations();
  await seedDatabase();
  await closeDb();

  const pyProc = await maybeStartPythonEngine(engineUrl);

  const child = spawn(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'next', mode, '--port', port],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: pgHandle.url,
        ENGINE_URL: engineUrl,
        SENTINEL_LOCAL_BOOT: '1',
      },
      shell: process.platform === 'win32',
    },
  );

  const shutdown = async () => {
    child.kill('SIGTERM');
    pyProc?.kill('SIGTERM');
    await pgHandle.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  child.on('exit', async (code) => {
    pyProc?.kill('SIGTERM');
    await pgHandle.stop();
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
