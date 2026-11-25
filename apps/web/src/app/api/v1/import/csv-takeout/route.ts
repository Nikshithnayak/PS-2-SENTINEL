import { NextResponse, type NextRequest } from 'next/server';
import { MetricTypeSchema } from '@sentinel/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { withSystemDb } from '@/db';
import { patientProfiles } from '@/db/schema';
import { parseCsvWithMapper, parseTakeoutJson } from '@/lib/ingestion/importers/csv-takeout';
import { ingestVitalBatch } from '@/lib/ingestion/quality';
import { checkPatientScope, requireSession } from '@/lib/session';

const ImportRequestSchema = z.object({
  patientId: z.string().uuid().optional(),
  format: z.enum(['csv', 'takeout_json']),
  content: z.string().min(5),
  mapping: z
    .object({
      timestampColumn: z.string(),
      valueColumn: z.string(),
      metricColumn: z.string().optional(),
      fixedMetricType: MetricTypeSchema.optional(),
      unitColumn: z.string().optional(),
      fixedUnit: z.string().optional(),
      contextColumn: z.string().optional(),
    })
    .optional(),
});

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const raw = await request.json().catch(() => null);
  const parsed = ImportRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid import request', details: parsed.error.flatten() },
      { status: 400 },
    );
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

  const out =
    parsed.data.format === 'takeout_json'
      ? parseTakeoutJson(parsed.data.content)
      : parseCsvWithMapper(
          parsed.data.content,
          parsed.data.mapping ?? {
            timestampColumn: 'timestamp',
            valueColumn: 'value',
            metricColumn: 'metric',
            unitColumn: 'unit',
          },
        );

  if (out.samples.length === 0) {
    return NextResponse.json({ error: 'No valid records parsed', skipped: out.skipped }, { status: 400 });
  }

  const batch = await ingestVitalBatch({
    patientId,
    source: out.samples[0]!.source,
    samples: out.samples,
    actorUserId: ctx.userId,
    isSynthetic: false,
  });

  return NextResponse.json({ parsedSkipped: out.skipped, ingest: batch }, { status: 201 });
}
