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
  parseBlePulseOximeterMeasurement,
} from '@/lib/ingestion/watch-normalizer';
import {
  BLE_CHARACTERISTICS,
  BLE_STANDARD_SERVICES,
  buildRequestDeviceOptions,
  checkBleAvailability,
  connectGattWithRetry,
  discoverWatchServices,
  formatBleConnectionError,
  type BluetoothDeviceLike,
  type GattCharacteristicLike,
  type GattServerLike,
} from '@/lib/ingestion/ble-watch';
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

import { GET as watchWebhookGet, POST as watchWebhookPost } from '@/app/api/v1/ingest/watch/route';
import { POST as providerSyncPost } from '@/app/api/v1/sync/provider/route';
import {
  DELETE as connectorDelete,
  GET as connectorStatusGet,
} from '@/app/api/v1/connectors/google/status/route';
import { GET as googleConnectGet } from '@/app/api/v1/connectors/google/connect/route';
import {
  resolveGoogleConnectorOAuthConfig,
  saveEncryptedGoogleConnectorTokens,
} from '@/lib/ingestion/connectors/google-cloud-health';

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
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
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

  it('normalizes Android Health Connect (HC Webhook) payloads and supports query-param auth on /api/v1/ingest/watch', async () => {
    const hcPayload = {
      heart_rate: [
        {
          metadata: { id: 'hc-hr-1', dataOrigin: 'com.sec.android.app.shealth' },
          startTime: '2026-11-27T07:00:00Z',
          samples: [{ time: '2026-11-27T07:00:10Z', beatsPerMinute: 71 }],
        },
      ],
      heart_rate_variability_rmssd: [
        { time: '2026-11-27T07:01:00Z', heartRateVariabilityMillis: 44.2 },
      ],
      oxygen_saturation: [{ time: '2026-11-27T07:02:00Z', percentage: 98 }],
      steps: [{ startTime: '2026-11-27T06:00:00Z', endTime: '2026-11-27T07:00:00Z', count: 840 }],
      sleep_sessions: [
        {
          startTime: '2026-11-26T22:30:00Z',
          endTime: '2026-11-27T05:30:00Z',
          stages: [
            { stage: 'deep', startTime: '2026-11-26T23:00:00Z', endTime: '2026-11-27T01:00:00Z' },
            { stage: 'awake', startTime: '2026-11-27T01:00:00Z', endTime: '2026-11-27T01:15:00Z' },
            { stage: 'rem', startTime: '2026-11-27T01:15:00Z', endTime: '2026-11-27T05:15:00Z' },
          ],
        },
      ],
    };

    const normalized = normalizeWatchPayload(hcPayload);
    expect(normalized.source).toBe('health_connect');
    expect(normalized.samples.map((s) => s.metricType)).toEqual([
      'heart_rate',
      'hrv_rmssd',
      'spo2',
      'steps',
      'sleep_duration_min',
    ]);
    expect(normalized.samples[4]?.value).toBe(360);
    expect(normalized.samples.every((s) => s.isSynthetic === false)).toBe(true);

    const pingReq = new NextRequest(
      `http://localhost:3000/api/v1/ingest/watch?apiKey=${encodeURIComponent(SEED_IDS.demoIngestApiKey)}`,
      { method: 'GET' },
    );
    const pingRes = await watchWebhookGet(pingReq);
    expect(pingRes.status).toBe(200);
    const pingBody = (await pingRes.json()) as { ok: boolean; patientId: string };
    expect(pingBody.ok).toBe(true);
    expect(pingBody.patientId).toBe(SEED_IDS.patientProfileId);

    const postReq = new NextRequest(
      `http://localhost:3000/api/v1/ingest/watch?apiKey=${encodeURIComponent(SEED_IDS.demoIngestApiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...hcPayload,
          idempotencyKey: `hc-webhook-${randomUUID()}`,
        }),
      },
    );
    const postRes = await watchWebhookPost(postReq);
    expect(postRes.status).toBe(201);
    const postJson = (await postRes.json()) as { recordsAccepted: number; isSynthetic: boolean };
    expect(postJson.recordsAccepted).toBe(5);
    expect(postJson.isSynthetic).toBe(false);
  });

  it('stores encrypted Google Fit tokens and syncs Google Fit dataset aggregates on POST /api/v1/sync/provider', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    mockSession = {
      userId: SEED_IDS.patientUserId,
      email: 'ramesh@example.org',
      name: 'Ramesh Pai',
      role: 'patient',
      locale: 'en',
    };

    const notConnReq = new NextRequest('http://localhost:3000/api/v1/sync/provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google_fit', evaluate: false }),
    });
    const notConnRes = await providerSyncPost(notConnReq);
    expect(notConnRes.status).toBe(400);
    const notConnBody = (await notConnRes.json()) as { status: string; connectUrl: string };
    expect(notConnBody.status).toBe('not_connected');
    expect(notConnBody.connectUrl).toContain('/api/v1/connectors/google/connect');

    await saveEncryptedGoogleConnectorTokens({
      userId: SEED_IDS.patientUserId,
      mode: 'google_fit',
      accessToken: 'gf-access-token-test',
      refreshToken: 'gf-refresh-token-test',
      expiresInSeconds: 3600,
      scope: 'https://www.googleapis.com/auth/fitness.heart_rate.read',
    });

    const statusRes = await connectorStatusGet(
      new NextRequest('http://localhost:3000/api/v1/connectors/google/status'),
    );
    expect(statusRes.status).toBe(200);
    const statusJson = (await statusRes.json()) as {
      connections: { google_fit: { connected: boolean; hasRefreshToken: boolean } };
    };
    expect(statusJson.connections.google_fit.connected).toBe(true);
    expect(statusJson.connections.google_fit.hasRefreshToken).toBe(true);

    globalThis.fetch = vi.fn(async (_url, init) => {
      const parsedBody = JSON.parse(String(init?.body ?? '{}')) as {
        aggregateBy?: Array<{ dataTypeName?: string }>;
      };
      const dt = parsedBody.aggregateBy?.[0]?.dataTypeName;
      if (dt === 'com.google.heart_rate.bpm') {
        return new Response(
          JSON.stringify({
            bucket: [
              {
                startTimeMillis: '1795700000000',
                dataset: [
                  {
                    dataSourceId: 'derived:com.google.heart_rate.bpm:merge',
                    point: [
                      {
                        startTimeNanos: '1795700000000000000',
                        value: [{ fpVal: 68.5 }],
                      },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ bucket: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const syncReq = new NextRequest('http://localhost:3000/api/v1/sync/provider', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google_fit', hoursBack: 24, evaluate: false }),
    });
    const syncRes = await providerSyncPost(syncReq);
    expect(syncRes.status).toBe(201);
    const syncBody = (await syncRes.json()) as {
      provider: string;
      recordsAccepted: number;
      isSynthetic: boolean;
    };
    expect(syncBody.provider).toBe('google_fit');
    expect(syncBody.recordsAccepted).toBe(1);
    expect(syncBody.isSynthetic).toBe(false);

    const delRes = await connectorDelete(
      new NextRequest('http://localhost:3000/api/v1/connectors/google/status?mode=google_fit', {
        method: 'DELETE',
      }),
    );
    expect(delRes.status).toBe(200);
  });

  it('routes Google Fit OAuth callback through /api/auth/callback/google with gfit_ state to prevent redirect_uri_mismatch', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    const oauthCfg = resolveGoogleConnectorOAuthConfig('google_fit', 'https://ps-2-sentinel.vercel.app');
    expect(oauthCfg.callbackUrl).toBe('https://ps-2-sentinel.vercel.app/api/auth/callback/google');

    mockSession = {
      userId: SEED_IDS.patientUserId,
      email: 'ramesh@example.org',
      name: 'Ramesh Pai',
      role: 'patient',
      locale: 'en',
    };

    const connectReq = new NextRequest('https://ps-2-sentinel.vercel.app/api/v1/connectors/google/connect?mode=fit', {
      headers: { host: 'ps-2-sentinel.vercel.app', 'x-forwarded-proto': 'https' },
    });
    const connectRes = await googleConnectGet(connectReq);
    expect(connectRes.status).toBe(307);
    const location = connectRes.headers.get('location') ?? '';
    const parsedUrl = new URL(location);
    expect(parsedUrl.origin).toBe('https://accounts.google.com');
    expect(parsedUrl.searchParams.get('redirect_uri')).toBe(
      'https://ps-2-sentinel.vercel.app/api/auth/callback/google',
    );
    expect(parsedUrl.searchParams.get('state') ?? '').toMatch(/^gfit_/);
  });

  it('builds Web Bluetooth scan options with acceptAllDevices default + HR/SpO2 optionalServices and parses 0x1822 PLX packets', async () => {
    const allOpts = buildRequestDeviceOptions('all_devices');
    expect('acceptAllDevices' in allOpts && allOpts.acceptAllDevices).toBe(true);
    expect(allOpts.optionalServices).toContain(BLE_STANDARD_SERVICES.HEART_RATE);
    expect(allOpts.optionalServices).toContain(BLE_STANDARD_SERVICES.PULSE_OXIMETER);
    expect(allOpts.optionalServices).toContain(BLE_STANDARD_SERVICES.DEVICE_INFORMATION);

    const hrOpts = buildRequestDeviceOptions('health_services');
    expect('filters' in hrOpts && hrOpts.filters).toEqual([
      { services: ['heart_rate'] },
      { services: [0x1822] },
    ]);

    // BLE 0x1822 Pulse Oximeter packet: flags=0x00, SpO2=97 (mantissa 97, exp 0 -> 0x0061), PR=74 (0x004A)
    const plxBuf = new ArrayBuffer(5);
    const plxView = new DataView(plxBuf);
    plxView.setUint8(0, 0x00);
    plxView.setUint16(1, 97, true);
    plxView.setUint16(3, 74, true);
    const parsedPlx = parseBlePulseOximeterMeasurement(plxView);
    expect(parsedPlx.spo2).toBe(97);
    expect(parsedPlx.pulseRate).toBe(74);

    // Unavailable SpO2 sentinel (0x07FF NaN) safely maps to null
    plxView.setUint16(1, 0x07ff, true);
    const nanPlx = parseBlePulseOximeterMeasurement(plxView);
    expect(nanPlx.spo2).toBeNull();
    expect(nanPlx.pulseRate).toBe(74);

    const insecure = await checkBleAvailability({ bluetooth: undefined }, false);
    expect(insecure.supported).toBe(false);
    expect(insecure.badgeLabel).toBe('HTTPS Required');

    const radioOff = await checkBleAvailability(
      {
        bluetooth: {
          requestDevice: async () => ({ name: 'Watch', addEventListener: () => {} }),
          getAvailability: async () => false,
        },
      },
      true,
    );
    expect(radioOff.supported).toBe(true);
    expect(radioOff.adapterAvailable).toBe(false);
    expect(radioOff.badgeLabel).toBe('Bluetooth Radio Off');
  });

  it('retries transient BLE GATT disconnects, reads 0x180A watch identity, and diagnoses proprietary watches without 0x180D', async () => {
    let attempts = 0;
    const fakeHrChar: GattCharacteristicLike = {
      value: null,
      startNotifications: async () => fakeHrChar,
      readValue: async () => new DataView(new ArrayBuffer(0)),
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const encoder = new TextEncoder();
    const toDv = (txt: string) => {
      const bytes = encoder.encode(txt);
      return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    };

    const gattServer: GattServerLike = {
      connected: true,
      connect: async () => {
        attempts += 1;
        if (attempts === 1) {
          const err = new Error('GATT Server is disconnected');
          err.name = 'NetworkError';
          throw err;
        }
        return gattServer;
      },
      disconnect: () => {},
      getPrimaryService: async (uuid) => {
        if (uuid === BLE_STANDARD_SERVICES.DEVICE_INFORMATION) {
          return {
            getCharacteristic: async (c) => ({
              value: null,
              startNotifications: async () => fakeHrChar,
              readValue: async () =>
                c === BLE_CHARACTERISTICS.MANUFACTURER_NAME
                  ? toDv('Noise')
                  : toDv('ColorFit Pro 5'),
              addEventListener: () => {},
              removeEventListener: () => {},
            }),
          };
        }
        if (uuid === BLE_STANDARD_SERVICES.BATTERY) {
          return {
            getCharacteristic: async () => ({
              value: null,
              startNotifications: async () => fakeHrChar,
              readValue: async () => new DataView(new Uint8Array([84]).buffer),
              addEventListener: () => {},
              removeEventListener: () => {},
            }),
          };
        }
        if (uuid === BLE_STANDARD_SERVICES.HEART_RATE) {
          return { getCharacteristic: async () => fakeHrChar };
        }
        throw new Error('Service missing');
      },
    };

    const fakeDevice: BluetoothDeviceLike = {
      name: '',
      gatt: gattServer,
      addEventListener: () => {},
    };

    const server = await connectGattWithRetry(fakeDevice, 2, 1);
    expect(attempts).toBe(2);

    const discovered = await discoverWatchServices(server, fakeDevice.name);
    expect(discovered.watchLabel).toBe('Noise ColorFit Pro 5');
    expect(discovered.batteryPct).toBe(84);
    expect(discovered.hrChar).not.toBeNull();

    // Proprietary Amazfit/OEM watch exposing only 0xFEE0 + Nordic UART (no 0x180D)
    const proprietaryServer: GattServerLike = {
      connected: true,
      connect: async () => proprietaryServer,
      disconnect: () => {},
      getPrimaryService: async () => {
        throw new Error('No 0x180D or 0x1822 service');
      },
      getPrimaryServices: async () => [
        { uuid: '0000fee0-0000-1000-8000-00805f9b34fb', getCharacteristic: async () => fakeHrChar },
      ],
    };
    const propDiag = await discoverWatchServices(proprietaryServer, 'Amazfit Bip 5');
    expect(propDiag.hrChar).toBeNull();
    expect(propDiag.plxChar).toBeNull();
    expect(propDiag.vendorDiagnosis).toContain('Amazfit / Zepp / Mi Band');

    const notFoundErr = new Error('User cancelled the requestDevice() chooser.');
    notFoundErr.name = 'NotFoundError';
    expect(formatBleConnectionError(notFoundErr, 'health_services')).toContain(
      'All Nearby Watches',
    );
    expect(formatBleConnectionError(notFoundErr, 'all_devices')).toContain(
      '1 active BLE link',
    );
  });
});
