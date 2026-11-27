import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { maybeTriggerAlertFromEvaluation } from '@/lib/alerts/outbox';
import { runAndPersistEvaluation } from '@/lib/engine/client';
import { GoogleHealthAdapter, OpenWearablesAdapter } from '@/lib/ingestion/adapters/providers';
import { resolveSessionPatientScope } from '@/lib/ingestion/auth';
import { ingestVitalBatch } from '@/lib/ingestion/quality';
import { requireSession } from '@/lib/session';

const SyncProviderSchema = z.object({
  provider: z.enum(['open_wearables', 'google_health_api']),
  patientId: z.string().uuid().optional(),
  externalUserId: z.string().min(1).max(160).optional(),
  accessToken: z.string().min(1).max(2048).optional(),
  hoursBack: z.number().int().min(1).max(720).default(24),
  evaluate: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const rawBody = await request.json().catch(() => ({}));
  const parsed = SyncProviderSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid provider sync request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const scoped = await resolveSessionPatientScope(ctx, parsed.data.patientId);
  if (scoped.error) return scoped.error;
  const { patientId } = scoped;

  const adapter =
    parsed.data.provider === 'google_health_api'
      ? new GoogleHealthAdapter()
      : new OpenWearablesAdapter();

  const health = adapter.healthCheck();
  if (!health.configured) {
    return NextResponse.json(
      {
        error: health.message,
        status: 'unconfigured',
        provider: parsed.data.provider,
      },
      { status: 400 },
    );
  }

  if (parsed.data.provider === 'google_health_api' && !parsed.data.accessToken) {
    return NextResponse.json(
      {
        error:
          'Google Health API sync requires a valid user OAuth accessToken with Google Health / Fitness vitals scope.',
        status: 'missing_token',
        provider: 'google_health_api',
      },
      { status: 400 },
    );
  }

  const endIso = new Date().toISOString();
  const startIso = new Date(Date.now() - parsed.data.hoursBack * 3600_000).toISOString();

  let samples;
  try {
    samples = await adapter.fetchRecentSamples({
      externalUserId: parsed.data.externalUserId ?? patientId,
      startIso,
      endIso,
      accessToken: parsed.data.accessToken,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Upstream provider sync failed',
        status: 'upstream_error',
        provider: parsed.data.provider,
      },
      { status: 502 },
    );
  }

  if (samples.length === 0) {
    return NextResponse.json({
      provider: parsed.data.provider,
      patientId,
      batchId: null,
      deduplicatedBatch: false,
      recordsReceived: 0,
      recordsAccepted: 0,
      recordsSkipped: 0,
      message: 'Connected to upstream provider, but no samples were returned for the selected window.',
    });
  }

  const ingested = await ingestVitalBatch({
    patientId,
    source: parsed.data.provider,
    samples: samples.map((s) => ({ ...s, isSynthetic: false })),
    actorUserId: ctx.userId,
    isSynthetic: false,
  });

  if (!parsed.data.evaluate || ingested.recordsAccepted === 0) {
    return NextResponse.json(
      {
        provider: parsed.data.provider,
        patientId,
        ...ingested,
      },
      { status: 201 },
    );
  }

  const evaluation = await runAndPersistEvaluation({
    patientId,
    actorUserId: ctx.userId,
  });
  const alertPolicyResult = await maybeTriggerAlertFromEvaluation({
    evaluation,
    actorUserId: ctx.userId,
  });

  return NextResponse.json(
    {
      provider: parsed.data.provider,
      patientId,
      ...ingested,
      evaluation: {
        level: evaluation.level,
        deteriorationIndex: evaluation.deteriorationIndex,
        alertOutcome: alertPolicyResult.outcome,
      },
    },
    { status: 201 },
  );
}
