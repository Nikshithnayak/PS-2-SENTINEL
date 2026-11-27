import { NextResponse } from 'next/server';
import { getPool } from '@/db';

export async function GET() {
  let dbOk = false;
  let dbError: string | null = null;
  try {
    await getPool().query('SELECT 1');
    dbOk = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : 'Database unreachable';
  }

  const configuredEngineUrl = process.env.ENGINE_URL?.trim();
  const isVercelWithoutExternalEngine = Boolean(process.env.VERCEL && !configuredEngineUrl);
  const engineUrl = configuredEngineUrl ?? 'http://127.0.0.1:8000';

  let engineOk = false;
  let engineMode: 'python-engine' | 'ts-deterministic' | 'ts-fallback' = 'ts-fallback';

  if (isVercelWithoutExternalEngine) {
    engineOk = true;
    engineMode = 'ts-deterministic';
  } else {
    try {
      const res = await fetch(`${engineUrl}/healthz`, {
        signal: AbortSignal.timeout(1500),
        cache: 'no-store',
      });
      engineOk = res.ok;
      engineMode = res.ok ? 'python-engine' : 'ts-fallback';
    } catch {
      engineOk = false;
      engineMode = 'ts-fallback';
    }
  }

  return NextResponse.json(
    {
      status: dbOk ? 'ok' : 'degraded',
      service: 'sentinel-web',
      database: { ok: dbOk, error: dbError },
      engine: {
        ok: engineOk,
        mode: engineMode,
        url: isVercelWithoutExternalEngine ? 'builtin://ts-engine' : engineUrl,
      },
      timestamp: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503 },
  );
}
