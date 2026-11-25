import { NextResponse, type NextRequest } from 'next/server';
import type { VitalSampleInput } from '@sentinel/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { withSystemDb } from '@/db';
import { patientProfiles } from '@/db/schema';
import { ingestVitalBatch } from '@/lib/ingestion/quality';
import { checkPatientScope, requireSession } from '@/lib/session';

const SimRequestSchema = z.object({
  patientId: z.string().uuid().optional(),
  scenario: z
    .enum([
      'baseline_stable',
      'early_infection',
      'hf_decompensation',
      'copd_exacerbation',
      'arrhythmia_episode',
      'dehydration_heat',
      'post_discharge_decline',
      'missed_medication',
      'fall_event',
      'exercise_confounder',
      'off_wrist_silence',
    ])
    .default('early_infection'),
  seed: z.number().int().min(0).max(1_000_000).default(42),
  totalDays: z.number().int().min(3).max(45).default(16),
});

/**
 * Deterministic TypeScript fallback when the Python FastAPI engine is offline,
 * guaranteeing identical `isSynthetic: true` tagging for dev smoke checks.
 */
function fallbackDeterministicSim(
  scenario: z.infer<typeof SimRequestSchema>['scenario'],
  seed: number,
  totalDays: number,
): { onsetAt: string | null; samples: VitalSampleInput[]; engineSource: string } {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  const totalHours = totalDays * 24;
  const startMs = now.getTime() - totalHours * 3_600_000;
  const onsetHours = scenario === 'baseline_stable' ? null : Math.max(24, totalHours - 36);
  const onsetAt = onsetHours !== null ? new Date(startMs + onsetHours * 3_600_000).toISOString() : null;

  const samples: VitalSampleInput[] = [];
  let rngState = (seed + 1) * 9301;
  const rand = () => {
    rngState = (rngState * 49297 + 233280) % 233280;
    return rngState / 233280 - 0.5;
  };

  for (let h = 0; h < totalHours; h += 2) {
    const ts = new Date(startMs + h * 3_600_000);
    const hour = ts.getUTCHours();
    const isSleep = hour >= 17 || hour < 1; // ~22:30-06:30 IST
    const inOnset = onsetHours !== null && h >= onsetHours;
    if (scenario === 'off_wrist_silence' && h >= totalHours - 16) continue;

    let rhr = 64 + (isSleep ? -3 : 2) + rand() * 3;
    let hrv = 34 + (isSleep ? 4 : -2) + rand() * 4;
    let spo2 = (scenario === 'copd_exacerbation' ? 91 : 97) + rand();
    let rr = (scenario === 'copd_exacerbation' ? 18 : 15) + rand();
    let temp = (isSleep ? -0.1 : 0.1) + rand() * 0.15;

    if (inOnset) {
      if (scenario === 'early_infection') {
        rhr += 13;
        hrv *= 0.65;
        temp += 0.9;
        rr += 4;
      } else if (scenario === 'copd_exacerbation') {
        spo2 -= 5.5;
        rr += 7;
      } else if (scenario === 'arrhythmia_episode') {
        rhr += 72;
        hrv += 45;
      } else if (scenario !== 'exercise_confounder') {
        rhr += 10;
        hrv *= 0.72;
      }
    }

    samples.push(
      {
        metricType: 'resting_heart_rate',
        value: Number(rhr.toFixed(1)),
        unit: 'bpm',
        recordedAt: ts.toISOString(),
        context: isSleep ? 'sleep' : 'rest',
        source: 'synthetic_sim',
        isSynthetic: true,
      },
      {
        metricType: 'hrv_rmssd',
        value: Number(Math.max(6, hrv).toFixed(1)),
        unit: 'ms',
        recordedAt: ts.toISOString(),
        context: isSleep ? 'sleep' : 'rest',
        source: 'synthetic_sim',
        isSynthetic: true,
      },
      {
        metricType: 'spo2',
        value: Number(Math.min(100, Math.max(75, spo2)).toFixed(1)),
        unit: '%',
        recordedAt: ts.toISOString(),
        context: isSleep ? 'sleep' : 'rest',
        source: 'synthetic_sim',
        isSynthetic: true,
      },
      {
        metricType: 'respiratory_rate',
        value: Number(rr.toFixed(1)),
        unit: 'breaths/min',
        recordedAt: ts.toISOString(),
        context: isSleep ? 'sleep' : 'rest',
        source: 'synthetic_sim',
        isSynthetic: true,
      },
      {
        metricType: 'skin_temp_deviation',
        value: Number(temp.toFixed(2)),
        unit: 'degC',
        recordedAt: ts.toISOString(),
        context: isSleep ? 'sleep' : 'rest',
        source: 'synthetic_sim',
        isSynthetic: true,
      },
    );
  }
  return { onsetAt, samples, engineSource: 'ts-fallback' };
}

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const raw = await request.json().catch(() => ({}));
  const parsed = SimRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid simulation parameters' }, { status: 400 });
  }

  let patientId = parsed.data.patientId;
  if (!patientId) {
    const own = await withSystemDb((tx) =>
      tx
        .select({ id: patientProfiles.id })
        .from(patientProfiles)
        .where(eq(patientProfiles.userId, ctx.userId))
        .limit(1),
    );
    patientId = own[0]?.id;
  }
  if (!patientId) {
    return NextResponse.json({ error: 'Target patientId required' }, { status: 400 });
  }
  const allowed = await checkPatientScope(ctx, patientId, 'vitals_read');
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let samples: VitalSampleInput[] = [];
  let onsetAt: string | null = null;
  let engineSource = 'python-engine';

  const engineUrl = process.env.ENGINE_URL ?? 'http://127.0.0.1:8000';
  try {
    const res = await fetch(`${engineUrl}/v1/sim/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenario: parsed.data.scenario,
        seed: parsed.data.seed,
        total_days: parsed.data.totalDays,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Engine HTTP ${res.status}`);
    const body = (await res.json()) as {
      onsetAt?: string | null;
      samples: VitalSampleInput[];
    };
    samples = body.samples;
    onsetAt = body.onsetAt ?? null;
  } catch {
    const fb = fallbackDeterministicSim(
      parsed.data.scenario,
      parsed.data.seed,
      parsed.data.totalDays,
    );
    samples = fb.samples;
    onsetAt = fb.onsetAt;
    engineSource = fb.engineSource;
  }

  const batch = await ingestVitalBatch({
    patientId,
    source: 'synthetic_sim',
    samples,
    actorUserId: ctx.userId,
    isSynthetic: true,
  });

  return NextResponse.json(
    {
      isSynthetic: true,
      scenario: parsed.data.scenario,
      seed: parsed.data.seed,
      onsetAt,
      engineSource,
      ingest: batch,
    },
    { status: 201 },
  );
}
