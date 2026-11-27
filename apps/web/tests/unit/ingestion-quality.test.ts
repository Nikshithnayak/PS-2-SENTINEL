import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { applyMigrations, closeDb, withSystemDb } from '@/db';
import { ensurePostgresRunning, type LocalPgHandle } from '@/db/local-pg';
import { ingestBatches, vitalRollupsHourly, vitalSamples } from '@/db/schema';
import { SEED_IDS, seedDatabase } from '@/db/seed';
import { buildSanitizedOpenMeteoUrls, classifyHeatRisk } from '@/lib/context/open-meteo';
import { parseAppleHealthXmlStream } from '@/lib/ingestion/importers/apple-xml';
import { parseCsvWithMapper, parseTakeoutJson } from '@/lib/ingestion/importers/csv-takeout';
import { evaluateDeviceSilence, ingestVitalBatch } from '@/lib/ingestion/quality';

let pgHandle: LocalPgHandle;

beforeAll(async () => {
  pgHandle = await ensurePostgresRunning(5435);
  process.env.DATABASE_URL = pgHandle.url;
  await applyMigrations();
  await seedDatabase();
  await withSystemDb(async (tx) => {
    await tx.delete(vitalRollupsHourly).where(eq(vitalRollupsHourly.patientId, SEED_IDS.patientProfileId));
    await tx.delete(vitalSamples).where(eq(vitalSamples.patientId, SEED_IDS.patientProfileId));
    await tx.delete(ingestBatches).where(eq(ingestBatches.patientId, SEED_IDS.patientProfileId));
  });
});

afterAll(async () => {
  await closeDb();
  await pgHandle?.stop();
});

describe('Phase 2 Importers, Data Quality & Provenance', () => {
  it('streams Apple Health export.xml across split chunks and converts HealthKit units', async () => {
    const xml = [
      '<HealthData><Record type="HKQuantityTypeIdentifierHeartRate" sourceName="Apple Watch" ',
      'unit="count/min" startDate="2026-11-24 06:00:00 +0530" endDate="2026-11-24 06:01:00 +0530" value="68"/>',
      '<Record type="HKQuantityTypeIdentifierOxygenSaturation" sourceName="Apple Watch" ',
      'unit="%" startDate="2026-11-24 06:05:00 +0530" endDate="2026-11-24 06:06:00 +0530" value="0.96"/>',
      '<Record type="HKQuantityTypeIdentifierBodyTemperature" sourceName="Apple Watch" ',
      'unit="degF" startDate="2026-11-24 06:10:00 +0530" endDate="2026-11-24 06:11:00 +0530" value="98.6"/>',
      '<Record type="HKQuantityTypeIdentifierRestingHeartRate" unit="bpm" startDate="2026-11-24 06:12:00 +0530" value="bad"/>',
      '</HealthData>',
    ];

    async function* chunked() {
      for (const part of xml) yield part;
    }

    const parsed = await parseAppleHealthXmlStream(chunked());
    expect(parsed.stats.accepted).toBe(3);
    expect(parsed.stats.skipped).toBe(1);
    const spo2 = parsed.samples.find((s) => s.metricType === 'spo2');
    expect(spo2?.value).toBe(96);
    const temp = parsed.samples.find((s) => s.metricType === 'body_temperature');
    expect(temp?.value).toBeCloseTo(37.0, 2);
  });

  it('parses CSV column mapping and Fitbit Takeout JSON', () => {
    const csv = `ts,kind,reading,u\n2026-11-24T08:00:00Z,resting_heart_rate,65,bpm\ninvalid,spo2,99,%`;
    const csvRes = parseCsvWithMapper(csv, {
      timestampColumn: 'ts',
      metricColumn: 'kind',
      valueColumn: 'reading',
      unitColumn: 'u',
    });
    expect(csvRes.samples).toHaveLength(1);
    expect(csvRes.skipped).toBe(1);

    const jsonRes = parseTakeoutJson(
      JSON.stringify([
        { dateTime: '2026-11-24 07:00:00', value: { bpm: 71, confidence: 3 } },
        { startTime: '2026-11-24T00:00:00Z', minutesAsleep: 410, efficiency: 88 },
      ]),
    );
    expect(jsonRes.samples).toHaveLength(3);

    // Google Fit Daily activity metrics.csv wide auto-detection
    const googleFitCsv =
      'Date,Move Minutes count,Step count,Average heart rate (bpm),Min heart rate (bpm)\n' +
      '2026-11-26,35,6420,74,62\n';
    const gfCsvRes = parseCsvWithMapper(googleFitCsv, {
      timestampColumn: 'timestamp',
      valueColumn: 'value',
      metricColumn: 'metric',
      unitColumn: 'unit',
    });
    expect(gfCsvRes.samples).toHaveLength(3);
    expect(gfCsvRes.samples.some((s) => s.metricType === 'steps' && s.value === 6420)).toBe(true);
    expect(
      gfCsvRes.samples.some((s) => s.metricType === 'resting_heart_rate' && s.value === 62),
    ).toBe(true);

    // Google Fit Takeout Data Points JSON
    const gfJsonRes = parseTakeoutJson(
      JSON.stringify({
        'Data Source': 'derived:com.google.heart_rate.bpm:com.google.android.gms:merge_heart_rate_bpm',
        'Data Points': [
          {
            startTimeNanos: '1795700000000000000',
            endTimeNanos: '1795700060000000000',
            fitValue: [{ value: { fpVal: 73.5 } }],
          },
        ],
      }),
    );
    expect(gfJsonRes.samples).toHaveLength(1);
    expect(gfJsonRes.samples[0]?.metricType).toBe('heart_rate');
    expect(gfJsonRes.samples[0]?.value).toBe(73.5);

    // Android Health Connect JSON
    const hcRes = parseTakeoutJson(
      JSON.stringify([
        { samples: [{ beatsPerMinute: 76, time: '2026-11-26T10:00:00Z' }] },
        { startTime: '2026-11-26T00:00:00Z', endTime: '2026-11-26T07:00:00Z', stages: [{}] },
      ]),
    );
    expect(hcRes.samples).toHaveLength(2);
    expect(hcRes.samples[1]?.metricType).toBe('sleep_duration_min');
    expect(hcRes.samples[1]?.value).toBe(420);
  });

  it('deduplicates batches, rejects out-of-bounds, and flags motion artifacts', async () => {
    const idempotencyKey = `unit-test-batch-${randomUUID()}`;
    const res1 = await ingestVitalBatch({
      patientId: SEED_IDS.patientProfileId,
      source: 'open_ingest_api',
      idempotencyKey,
      samples: [
        {
          metricType: 'steps',
          value: 95,
          unit: 'count',
          recordedAt: '2026-11-24T10:01:00.000Z',
          context: 'exercise',
          source: 'open_ingest_api',
          isSynthetic: false,
        },
        {
          metricType: 'spo2',
          value: 93,
          unit: '%',
          recordedAt: '2026-11-24T10:02:00.000Z',
          context: 'rest',
          source: 'open_ingest_api',
          isSynthetic: false,
        },
        {
          metricType: 'heart_rate',
          value: 999, // impossible
          unit: 'bpm',
          recordedAt: '2026-11-24T10:03:00.000Z',
          context: 'rest',
          source: 'open_ingest_api',
          isSynthetic: false,
        },
      ],
    });

    expect(res1.recordsAccepted).toBe(2);
    expect(res1.recordsSkipped).toBe(1);
    expect(res1.motionFlaggedCount).toBe(1);

    const dupRes = await ingestVitalBatch({
      patientId: SEED_IDS.patientProfileId,
      source: 'open_ingest_api',
      idempotencyKey,
      samples: [
        {
          metricType: 'steps',
          value: 95,
          unit: 'count',
          recordedAt: '2026-11-24T10:01:00.000Z',
          context: 'exercise',
          source: 'open_ingest_api',
          isSynthetic: false,
        },
      ],
    });
    expect(dupRes.deduplicatedBatch).toBe(true);

    const rows = await withSystemDb((tx) =>
      tx
        .select()
        .from(vitalSamples)
        .where(eq(vitalSamples.patientId, SEED_IDS.patientProfileId)),
    );
    const spo2Row = rows.find((r) => r.metricType === 'spo2');
    expect(spo2Row?.qualityFlags).toContain('motion_artifact');
    expect(spo2Row?.dataConfidence).toBeLessThan(0.5);

    // Silence check 16 hours after last sample
    const silence = await evaluateDeviceSilence(
      SEED_IDS.patientProfileId,
      new Date('2026-11-25T02:30:00.000Z'),
    );
    expect(silence.isSilent).toBe(true);
    expect(silence.hoursSilent).toBeGreaterThanOrEqual(16);
  });

  it('sanitizes Open-Meteo URLs with zero PII and rounded coordinates', () => {
    const { weatherUrl, roundedLat, roundedLon } = buildSanitizedOpenMeteoUrls(12.91414, 74.85603);
    expect(roundedLat).toBe(12.91);
    expect(roundedLon).toBe(74.86);
    expect(weatherUrl).not.toContain('Ramesh');
    expect(weatherUrl).not.toContain('12.91414');
    expect(classifyHeatRisk(38.2).level).toBe('high');
  });
});
