import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { maybeTriggerAlertFromEvaluation } from '@/lib/alerts/outbox';
import { runAndPersistEvaluation } from '@/lib/engine/client';
import { GoogleFitAdapter, GoogleHealthAdapter, OpenWearablesAdapter } from '@/lib/ingestion/adapters/providers';
import { resolveIngestAuth, resolveSessionPatientScope } from '@/lib/ingestion/auth';
import {
  getValidGoogleConnectorToken,
  resolveRequestOrigin,
} from '@/lib/ingestion/connectors/google-cloud-health';
import { ingestVitalBatch } from '@/lib/ingestion/quality';
import { requireSession } from '@/lib/session';

const SyncProviderSchema = z.object({
  provider: z.enum(['open_wearables', 'google_fit', 'google_health_api']),
  patientId: z.string().uuid().optional(),
  externalUserId: z.string().min(1).max(160).optional(),
  accessToken: z.string().min(1).max(2048).optional(),
  hoursBack: z.number().int().min(1).max(720).default(336),
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
    parsed.data.provider === 'google_fit'
      ? new GoogleFitAdapter()
      : parsed.data.provider === 'google_health_api'
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

  let effectiveAccessToken = parsed.data.accessToken;
  if (
    (parsed.data.provider === 'google_fit' || parsed.data.provider === 'google_health_api') &&
    !effectiveAccessToken
  ) {
    const stored = await getValidGoogleConnectorToken({
      userId: ctx.userId,
      mode: parsed.data.provider,
      origin: resolveRequestOrigin(request),
    });
    effectiveAccessToken = stored?.accessToken;
  }

  if (
    (parsed.data.provider === 'google_fit' || parsed.data.provider === 'google_health_api') &&
    !effectiveAccessToken
  ) {
    const modeParam = parsed.data.provider === 'google_health_api' ? 'health' : 'fit';
    return NextResponse.json(
      {
        error:
          parsed.data.provider === 'google_fit'
            ? 'Connect your Google Fit account first using the "Connect Google Fit" button.'
            : 'Connect Google Health API v4 first using the "Connect Google Health" button.',
        status: 'not_connected',
        connectUrl: `/api/v1/connectors/google/connect?mode=${modeParam}`,
        provider: parsed.data.provider,
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
      accessToken: effectiveAccessToken,
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
      message:
        parsed.data.provider === 'google_fit'
          ? 'Connected to Google Fit, but Google returned 0 readings in the last 14 days (HR, Steps, Sleep, SpO2). Check Google Fit sync on Android or use Android Health Connect Direct Bridge.'
          : 'Connected to upstream provider, but no samples were returned for the selected window.',
    });
  }

  const metricCounts: Record<string, number> = {};
  for (const s of samples) {
    metricCounts[s.metricType] = (metricCounts[s.metricType] ?? 0) + 1;
  }
  const breakdownLabel = Object.entries(metricCounts)
    .map(([m, c]) => `${m}: ${c}`)
    .join(', ');
  const hrSamplesCount = (metricCounts.heart_rate ?? 0) + (metricCounts.resting_heart_rate ?? 0);
  const gfitHrNotice =
    parsed.data.provider === 'google_fit' && hrSamplesCount === 0
      ? ' · Note: Google Fit returned 0 heart_rate readings in the last 14 days — ensure continuous heart-rate sharing is enabled inside Google Fit / Health Connect, or pair Android Health Connect Direct Bridge.'
      : '';

  const ingested = await ingestVitalBatch({
    patientId,
    source: parsed.data.provider,
    samples: samples.map((s) => ({ ...s, isSynthetic: false })),
    actorUserId: ctx.userId,
    isSynthetic: false,
  });

  const summaryMessage = `Synced ${ingested.recordsAccepted} real sample(s) from ${parsed.data.provider} (${breakdownLabel}).${gfitHrNotice}`;

  if (!parsed.data.evaluate || ingested.recordsAccepted === 0) {
    return NextResponse.json(
      {
        provider: parsed.data.provider,
        patientId,
        metricCounts,
        message: summaryMessage,
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
      metricCounts,
      message: summaryMessage,
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
