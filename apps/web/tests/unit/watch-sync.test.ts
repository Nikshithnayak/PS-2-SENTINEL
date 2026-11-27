import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { applyMigrations, closeDb, withSystemDb } from '@/db';
import { ensurePostgresRunning, type LocalPgHandle } from '@/db/local-pg';
import { vitalSamples } from '@/db/schema';
import { SEED_IDS, seedDatabase } from '@/db/seed';
import {
  computeRmssdFromRrIntervals,
  normalizeWatchPayload,
  parseBleHeartRateMeasurement,
} from '@/lib/ingestion/watch-normalizer';
import type { SessionContext } from '@/lib/session';

let mockSession: SessionContext | null = null;

vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>();
  return {
    ...actual,
    getSessionContext: async () => mockSession,
    requireSession: async () => {
      if (!mockSession) {
        return { error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
      }
      return { ctx: mockSession };
    },
  };
});

import { POST as watchWebhookPost } from '@/app/api/v1/ingest/watch/route';
import { POST as providerSyncPost } from '@/app/api/v1/sync/provider/route';

let pgHandle: LocalPgHandle;
const originalFetch = globalThis.fetch;

beforeAll(async () => {
  await closeDb();
  pgHandle = await ensurePostgresRunning(5441);
  process.env.DATABASE_URL = pgHandle.url;
  await applyMigrations();
  await seedDatabase();
});

afterEach(() => {
  mockSession = null;
  globalThis.fetch = originalFetch;
  delete process.env.OPEN_WEARABLES_URL;
  delete process.env.OPEN_WEARABLES_API_KEY;
});

afterAll(async () => {
  await closeDb();
  await pgHandle?.stop();
});

describe('Universal Smartwatch Sync (BLE GATT, Webhook Normalizer, Cloud Bridges)', () => {
  it('parses BLE 0x2A37 8-bit, 16-bit, sensor contact, and RR-interval RMSSD packets', () => {
    const simpleBuf = new Uint8Array([0x00, 74]);
    const simple = parseBleHeartRateMeasurement(new DataView(simpleBuf.buffer));
    expect(simple.bpm).toBe(74);
    expect(simple.contactDetected).toBe(true);
    expect(simple.rrIntervalsMs).toEqual([]);
    expect(simple.hrvRmssdMs).toBeNull();

    // Flags 0x17: 16-bit HR (0x01) + contact supported & detected (0x06) + RR intervals (0x10)
    const rr1024A = Math.round((800 * 1024) / 1000);
    const rr1024B = Math.round((845 * 1024) / 1000);
    const rr1024C = Math.round((795 * 1024) / 1000);
    const packet = new ArrayBuffer(9);
    const dv = new DataView(packet);
    dv.setUint8(0, 0x17);
    dv.setUint16(1, 128, true);
    dv.setUint16(3, rr1024A, true);
    dv.setUint16(5, rr1024B, true);
    dv.setUint16(7, rr1024C, true);

    const rich = parseBleHeartRateMeasurement(dv);
    expect(rich.bpm).toBe(128);
    expect(rich.contactSupported).toBe(true);
    expect(rich.contactDetected).toBe(true);
    expect(rich.rrIntervalsMs).toHaveLength(3);
    expect(rich.hrvRmssdMs).not.toBeNull();
    expect(rich.hrvRmssdMs!).toBeGreaterThan(30);
    expect(computeRmssdFromRrIntervals([800, 800])).toBeNull();
  });

  it('normalizes flat watch snapshots and iOS Health Auto Export JSON cleanly with isSynthetic=false', () => {
    const flat = normalizeWatchPayload({
      deviceModel: 'Garmin Forerunner 265',
      recordedAt: '2026-11-27T08:15:00+05:30',
      heartRate: 71,
      spo2: 98,
      hrv: 46,
      sleepMinutes: 425,
      steps: 6150,
      isSynthetic: true, // Must be stripped and forced to false
    });
    expect(flat.samples).toHaveLength(5);
    expect(flat.samples.every((s) => s.isSynthetic === false)).toBe(true);
    expect(flat.samples.every((s) => s.deviceModel === 'Garmin Forerunner 265')).toBe(true);

    const healthAutoExport = normalizeWatchPayload({
      data: {
        metrics: [
          {
            name: 'heart_rate',
            units: 'bpm',
            data: [{ date: '2026-11-27 07:30:00 +0530', qty: 69, source: 'Apple Watch Ultra 2' }],
          },
          {
            name: 'apple_sleeping_wrist_temperature',
            units: 'degF',
            data: [{ date: '2026-11-27T01:45:00Z', Avg: 0.9 }],
          },
        ],
      },
    });
    expect(healthAutoExport.samples).toHaveLength(2);
    expect(healthAutoExport.samples[0]?.metricType).toBe('heart_rate');
    expect(healthAutoExport.samples[1]?.metricType).toBe('skin_temp_deviation');
    expect(healthAutoExport.samples[1]?.unit).toBe('degF');
  });

  it('enforces x-api-key auth on POST /api/v1/ingest/watch and persists verified real watch readings', async () => {
    const unauthReq = new NextRequest('http://localhost:3000/api/v1/ingest/watch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ heartRate: 72 }),
    });
    const unauthRes = await watchWebhookPost(unauthReq);
    expect(unauthRes.status).toBe(401);

    const badPayloadReq = new NextRequest('http://localhost:3000/api/v1/ingest/watch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': SEED_IDS.demoIngestApiKey,
      },
      body: JSON.stringify({ note: 'missing metrics' }),
    });
    const badRes = await watchWebhookPost(badPayloadReq);
    expect(badRes.status).toBe(400);

    const idempotencyKey = `watch-webhook-${randomUUID()}`;
    const validReq = new NextRequest('http://localhost:3000/api/v1/ingest/watch', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': SEED_IDS.demoIngestApiKey,
      },
      body: JSON.stringify({
        idempotencyKey,
        deviceModel: 'Galaxy Watch 7',
        recordedAt: '2026-11-27T09:00:00+05:30',
        heartRate: 73,
        spo2: 98,
        steps: 3420,
      }),
    });
    const okRes = await watchWebhookPost(validReq);
    expect(okRes.status).toBe(201);
    const json = (await okRes.json()) as {
      recordsAccepted: number;
      isSynthetic: boolean;
      patientId: string;
    };
    expect(json.patientId).toBe(SEED_IDS.patientProfileId);
    expect(json.recordsAccepted).toBe(3);
    expect(json.isSynthetic).toBe(false);

    const dbRows = await withSystemDb((tx) =>
      tx.select().from(vitalSamples).where(eq(vitalSamples.patientId, SEED_IDS.patientProfileId)),
    );
    expect(dbRows.some((r) => r.deviceModel === 'Galaxy Watch 7' && r.isSynthetic === false)).toBe(
      true,
    );
  });

  it('handles unconfigured providers honestly and persists fetched samples on POST /api/v1/sync/provider', async () => {
    const unauthReq = new NextRequest('http://localhost:3000/api/v1/sync/provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'open_wearables' }),
    });
    const unauthRes = await providerSyncPost(unauthReq);
    expect(unauthRes.status).toBe(401);

    mockSession = {
      userId: SEED_IDS.patientUserId,
      email: 'ramesh@example.org',
      name: 'Ramesh Pai',
      role: 'patient',
      locale: 'en',
    };

    const unconfReq = new NextRequest('http://localhost:3000/api/v1/sync/provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'open_wearables', evaluate: false }),
    });
    const unconfRes = await providerSyncPost(unconfReq);
    expect(unconfRes.status).toBe(400);
    const unconfBody = (await unconfRes.json()) as { status: string; error: string };
    expect(unconfBody.status).toBe('unconfigured');
    expect(unconfBody.error).toContain('OPEN_WEARABLES_URL');

    process.env.OPEN_WEARABLES_URL = 'https://wearables.internal.test';
    process.env.OPEN_WEARABLES_API_KEY = 'ow_test_secret';
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          data: [
            {
              type: 'heart_rate',
              value: 66,
              unit: 'bpm',
              timestamp: '2026-11-27T09:15:00.000Z',
              source: 'Polar Vantage V3',
            },
            {
              type: 'oxygen_saturation',
              value: 99,
              unit: '%',
              timestamp: '2026-11-27T09:15:00.000Z',
              source: 'Polar Vantage V3',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const okReq = new NextRequest('http://localhost:3000/api/v1/sync/provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'open_wearables', hoursBack: 12, evaluate: false }),
    });
    const okRes = await providerSyncPost(okReq);
    expect(okRes.status).toBe(201);
    const okBody = (await okRes.json()) as {
      provider: string;
      recordsAccepted: number;
      isSynthetic: boolean;
    };
    expect(okBody.provider).toBe('open_wearables');
    expect(okBody.recordsAccepted).toBe(2);
    expect(okBody.isSynthetic).toBe(false);
  });
});
