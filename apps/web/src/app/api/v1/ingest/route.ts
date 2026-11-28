import { NextResponse, type NextRequest } from 'next/server';
import { IngestBatchSchema } from '@sentinel/shared';
import { maybeTriggerAlertFromEvaluation } from '@/lib/alerts/outbox';
import { runAndPersistEvaluation } from '@/lib/engine/client';
import { resolveIngestAuth } from '@/lib/ingestion/auth';
import { ingestVitalBatch } from '@/lib/ingestion/quality';

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
  const authRes = await resolveIngestAuth(request, input.patientId);
  if (authRes.error) return authRes.error;

  const source = input.samples[0]?.source ?? 'open_ingest_api';
  const result = await ingestVitalBatch({
    patientId: authRes.auth.patientId,
    source,
    samples: input.samples,
    idempotencyKey: input.idempotencyKey,
    actorUserId: authRes.auth.actorUserId,
  });

  const shouldEvaluate =
    input.evaluate === true || request.nextUrl.searchParams.get('evaluate') === 'true';

  if (!shouldEvaluate || result.recordsAccepted === 0) {
    return NextResponse.json(result, { status: 201 });
  }

  const evaluation = await runAndPersistEvaluation({
    patientId: authRes.auth.patientId,
    actorUserId: authRes.auth.actorUserId,
  });
  const alertPolicyResult = await maybeTriggerAlertFromEvaluation({
    evaluation,
    actorUserId: authRes.auth.actorUserId,
  });

  return NextResponse.json(
    {
      ...result,
      evaluation: {
        level: evaluation.level,
        deteriorationIndex: evaluation.deteriorationIndex,
        alertOutcome: alertPolicyResult.outcome,
        alertId: alertPolicyResult.alertId,
      },
    },
    { status: 201 },
  );
}
