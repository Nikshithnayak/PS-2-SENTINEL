import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireSession } from '@/lib/session';

const BenchmarkBodySchema = z.object({
  seeds: z.array(z.number().int().min(0).max(1_000_000)).default([42, 43]),
  totalDays: z.number().int().min(10).max(30).default(16),
  includeAblations: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;

  const raw = await request.json().catch(() => ({}));
  const parsed = BenchmarkBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid benchmark configuration' }, { status: 400 });
  }

  const engineUrl = process.env.ENGINE_URL ?? 'http://127.0.0.1:8000';
  try {
    const resp = await fetch(`${engineUrl}/v1/eval/benchmark`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed.data),
      signal: AbortSignal.timeout(45_000),
    });
    if (!resp.ok) {
      return NextResponse.json({ error: 'Python engine benchmark failed' }, { status: 502 });
    }
    const body = await resp.json();
    return NextResponse.json(body);
  } catch {
    return NextResponse.json(
      {
        error: 'Python detection engine is offline. Start services/engine to run full walk-forward ablations.',
      },
      { status: 503 },
    );
  }
}
