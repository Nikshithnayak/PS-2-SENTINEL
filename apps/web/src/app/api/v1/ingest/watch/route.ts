import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { maybeTriggerAlertFromEvaluation } from '@/lib/alerts/outbox';
import { runAndPersistEvaluation } from '@/lib/engine/client';
import { resolveIngestAuth } from '@/lib/ingestion/auth';
import { ingestVitalBatch } from '@/lib/ingestion/quality';
import { normalizeWatchPayload } from '@/lib/ingestion/watch-normalizer';

const UuidSchema = z.string().uuid();

/**
 * Allows companion apps (HC Webhook, Health Auto Export, Tasker) to verify
 * webhook connectivity and API key auth cleanly before syncing batches.
 */
export async function GET(request: NextRequest) {
  const rawPatient = request.nextUrl.searchParams.get('patientId') ?? undefined;
  if (rawPatient !== undefined && !UuidSchema.safeParse(rawPatient).success) {
    return NextResponse.json({ error: 'Invalid patientId UUID' }, { status: 400 });
  }
  const authRes = await resolveIngestAuth(request, rawPatient);
  if (authRes.error) return authRes.error;

  return NextResponse.json({
    ok: true,
    endpoint: '/api/v1/ingest/watch',
    patientId: authRes.auth.patientId,
    supportedPayloads: [
      'health_connect_webhook',
      'apple_health_auto_export',
      'flat_watch_json',
      'canonical_samples',
    ],
  });
}

/**
 * Universal smartwatch webhook endpoint accepting companion-app JSON snapshots
 * (Apple Shortcuts, Health Auto Export, Android Health Connect / Tasker / Gadgetbridge)
 * and normalizing them into verified non-synthetic `VitalSampleInput` batches.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.json().catch(() => null);
  const normalized = normalizeWatchPayload(rawBody);

  const rawRequestedPatient =
    normalized.patientId ?? request.nextUrl.searchParams.get('patientId') ?? undefined;
  if (rawRequestedPatient !== undefined && !UuidSchema.safeParse(rawRequestedPatient).success) {
    return NextResponse.json({ error: 'Invalid patientId UUID' }, { status: 400 });
  }

  const authRes = await resolveIngestAuth(request, rawRequestedPatient);
  if (authRes.error) return authRes.error;

  if (normalized.samples.length === 0) {
    return NextResponse.json(
      {
        error: 'No valid smartwatch vital readings found in payload',
        ignoredFields: normalized.ignoredFields,
      },
      { status: 400 },
    );
  }

  const ingested = await ingestVitalBatch({
    patientId: authRes.auth.patientId,
    source: normalized.source,
    samples: normalized.samples.map((s) => ({ ...s, isSynthetic: false })),
    idempotencyKey: normalized.idempotencyKey,
    actorUserId: authRes.auth.actorUserId,
    isSynthetic: false,
  });

  const shouldEvaluate =
    normalized.evaluate || request.nextUrl.searchParams.get('evaluate') === 'true';

  if (!shouldEvaluate || ingested.recordsAccepted === 0) {
    return NextResponse.json(
      {
        ...ingested,
        patientId: authRes.auth.patientId,
        normalizedCount: normalized.samples.length,
        ignoredFields: normalized.ignoredFields,
      },
      { status: 201 },
    );
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
      ...ingested,
      patientId: authRes.auth.patientId,
      normalizedCount: normalized.samples.length,
      ignoredFields: normalized.ignoredFields,
      evaluation: {
        level: evaluation.level,
        deteriorationIndex: evaluation.deteriorationIndex,
        alertOutcome: alertPolicyResult.outcome,
      },
    },
    { status: 201 },
  );
}
