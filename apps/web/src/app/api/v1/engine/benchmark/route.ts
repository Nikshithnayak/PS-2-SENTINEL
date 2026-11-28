import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { runTsCausalBenchmarkFallback } from '@/lib/engine/benchmark-fallback';
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

  const engineUrl = process.env.ENGINE_URL?.trim();
  const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true';

  if (engineUrl || !isVercel) {
    const targetUrl = engineUrl || 'http://127.0.0.1:8000';
    try {
      const resp = await fetch(`${targetUrl}/v1/eval/benchmark`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(75_000),
      });
      if (resp.ok) {
        const body = await resp.json();
        return NextResponse.json(body);
      }
    } catch {
      // Fall through to deterministic TypeScript walk-forward benchmark fallback
    }
  }

  const fallbackResult = runTsCausalBenchmarkFallback(parsed.data);
  return NextResponse.json(fallbackResult);
}
