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

  let engineOk = false;
  const engineUrl = process.env.ENGINE_URL ?? 'http://127.0.0.1:8000';
  try {
    const res = await fetch(`${engineUrl}/healthz`, {
      signal: AbortSignal.timeout(1500),
      cache: 'no-store',
    });
    engineOk = res.ok;
  } catch {
    engineOk = false;
  }

  return NextResponse.json(
    {
      status: dbOk ? 'ok' : 'degraded',
      service: 'sentinel-web',
      database: { ok: dbOk, error: dbError },
      engine: { ok: engineOk, url: engineUrl },
      timestamp: new Date().toISOString(),
    },
    { status: dbOk ? 200 : 503 },
  );
}
