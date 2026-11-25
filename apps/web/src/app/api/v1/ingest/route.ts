import { NextResponse, type NextRequest } from 'next/server';
import { hashApiKey, IngestBatchSchema } from '@sentinel/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { withSystemDb } from '@/db';
import { apiKeys } from '@/db/schema';
import { ingestVitalBatch } from '@/lib/ingestion/quality';
import { checkPatientScope, getSessionContext } from '@/lib/session';

export async function POST(request: NextRequest) {
  const rawBody = await request.json().catch(() => null);
  const parsed = IngestBatchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid ingestion batch payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = parsed.data;
  const headerKey = request.headers.get('x-api-key');
  let actorUserId: string | null = null;

  if (headerKey) {
    const hashed = hashApiKey(headerKey.trim());
    const keyMatch = await withSystemDb(async (tx) => {
      const rows = await tx
        .select()
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.keyHash, hashed),
            eq(apiKeys.patientId, input.patientId),
            isNull(apiKeys.revokedAt),
          ),
        )
        .limit(1);
      if (rows[0]) {
        await tx
          .update(apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(apiKeys.id, rows[0].id));
      }
      return rows[0] ?? null;
    });

    if (!keyMatch) {
      return NextResponse.json({ error: 'Invalid or revoked API key for patient' }, { status: 401 });
    }
  } else {
    const ctx = await getSessionContext();
    if (!ctx) {
      return NextResponse.json(
        { error: 'Authentication or x-api-key header required' },
        { status: 401 },
      );
    }
    const allowed = await checkPatientScope(ctx, input.patientId, 'vitals_read');
    if (!allowed) {
      return NextResponse.json({ error: 'Forbidden for target patient' }, { status: 403 });
    }
    actorUserId = ctx.userId;
  }

  const source = input.samples[0]?.source ?? 'open_ingest_api';
  const result = await ingestVitalBatch({
    patientId: input.patientId,
    source,
    samples: input.samples,
    idempotencyKey: input.idempotencyKey,
    actorUserId,
  });

  return NextResponse.json(result, { status: 201 });
}
