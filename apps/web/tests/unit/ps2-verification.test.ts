import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleFitAdapter } from '@/lib/ingestion/adapters/providers';
import {
  evaluateLocalDeterministicEngine,
  type TsSampleInput,
} from '@/lib/engine/ts-fallback';

describe('GoogleFitAdapter Sleep Sessions & DataSources Fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('imports HR, Steps, SpO2, Sleep Sessions (activityType=72) and falls back to raw dataSources when aggregate returns 400', async () => {
    const now = Date.now();
    const sleepStart = now - 9 * 3_600_000;
    const sleepEnd = sleepStart + 420 * 60_000;

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('dataset:aggregate')) {
        const rawBody = typeof init?.body === 'string' ? init.body : '';
        const parsed = rawBody ? (JSON.parse(rawBody) as { aggregateBy?: Array<{ dataSourceId?: string }> }) : {};
        const dsId = parsed.aggregateBy?.[0]?.dataSourceId;
        if (!dsId) {
          return new Response(JSON.stringify({ error: { message: 'No default datasource found' } }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          });
        }
        // Simulate raw dataset range fallback when dataSourceId aggregate also has no points for SpO2
        if (dsId.includes('oxygen_saturation')) {
          return new Response(JSON.stringify({ bucket: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (dsId.includes('heart_rate')) {
          return new Response(
            JSON.stringify({
              bucket: [
                {
                  startTimeMillis: String(now - 3_600_000),
                  endTimeMillis: String(now),
                  dataset: [
                    {
                      dataSourceId: dsId,
                      point: [
                        {
                          startTimeNanos: String((now - 1_800_000) * 1_000_000),
                          endTimeNanos: String((now - 1_740_000) * 1_000_000),
                          value: [{ fpVal: 68 }],
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
        if (dsId.includes('step_count')) {
          return new Response(
            JSON.stringify({
              bucket: [
                {
                  startTimeMillis: String(now - 3_600_000),
                  endTimeMillis: String(now),
                  dataset: [
                    {
                      dataSourceId: dsId,
                      point: [
                        {
                          startTimeNanos: String((now - 3_600_000) * 1_000_000),
                          endTimeNanos: String((now - 1_800_000) * 1_000_000),
                          value: [{ intVal: 1450 }],
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
        if (dsId.includes('sleep.segment')) {
          return new Response(
            JSON.stringify({
              bucket: [
                {
                  startTimeMillis: String(sleepStart),
                  endTimeMillis: String(sleepEnd),
                  dataset: [
                    {
                      dataSourceId: dsId,
                      point: [
                        {
                          startTimeNanos: String(sleepStart * 1_000_000),
                          endTimeNanos: String((sleepStart + 360 * 60_000) * 1_000_000),
                          value: [{ intVal: 4 }],
                        },
                        {
                          startTimeNanos: String((sleepStart + 360 * 60_000) * 1_000_000),
                          endTimeNanos: String(sleepEnd * 1_000_000),
                          value: [{ intVal: 1 }],
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
      }
      if (url.includes('/sessions?')) {
        return new Response(
          JSON.stringify({
            session: [
              {
                id: 'sleep-session-1',
                name: 'Night Sleep',
                activityType: 72,
                startTimeMillis: String(sleepStart),
                endTimeMillis: String(sleepEnd),
                application: { packageName: 'com.google.android.apps.fitness' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/dataSources')) {
        return new Response(
          JSON.stringify({
            dataSource: [
              {
                dataStreamId: 'derived:com.google.heart_rate.bpm:watch',
                dataType: { name: 'com.google.heart_rate.bpm' },
              },
              {
                dataStreamId: 'derived:com.google.step_count.delta:watch',
                dataType: { name: 'com.google.step_count.delta' },
              },
              {
                dataStreamId: 'derived:com.google.oxygen_saturation:watch',
                dataType: { name: 'com.google.oxygen_saturation' },
              },
              {
                dataStreamId: 'derived:com.google.sleep.segment:watch',
                dataType: { name: 'com.google.sleep.segment' },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes(encodeURIComponent('derived:com.google.heart_rate.bpm:watch'))) {
        return new Response(
          JSON.stringify({
            point: [
              {
                startTimeNanos: String((now - 1_800_000) * 1_000_000),
                endTimeNanos: String((now - 1_740_000) * 1_000_000),
                value: [{ fpVal: 68 }],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes(encodeURIComponent('derived:com.google.step_count.delta:watch'))) {
        return new Response(
          JSON.stringify({
            point: [
              {
                startTimeNanos: String((now - 3_600_000) * 1_000_000),
                endTimeNanos: String((now - 1_800_000) * 1_000_000),
                value: [{ intVal: 1450 }],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes(encodeURIComponent('derived:com.google.oxygen_saturation:watch'))) {
        return new Response(
          JSON.stringify({
            point: [
              {
                startTimeNanos: String((now - 1_800_000) * 1_000_000),
                endTimeNanos: String((now - 1_740_000) * 1_000_000),
                value: [{ fpVal: 97.5 }],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes(encodeURIComponent('derived:com.google.sleep.segment:watch'))) {
        return new Response(
          JSON.stringify({
            point: [
              // 360 min light/deep sleep (type 4) + 60 min awake (type 1) => 360 / 420 = 85.7%
              {
                startTimeNanos: String(sleepStart * 1_000_000),
                endTimeNanos: String((sleepStart + 360 * 60_000) * 1_000_000),
                value: [{ intVal: 4 }],
              },
              {
                startTimeNanos: String((sleepStart + 360 * 60_000) * 1_000_000),
                endTimeNanos: String(sleepEnd * 1_000_000),
                value: [{ intVal: 1 }],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ point: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const adapter = new GoogleFitAdapter();
    const samples = await adapter.fetchRecentSamples({
      externalUserId: 'patient-gfit-test',
      startIso: new Date(now - 48 * 3_600_000).toISOString(),
      endIso: new Date(now).toISOString(),
      accessToken: 'mock-token',
    });

    expect(fetchMock).toHaveBeenCalled();
    const metrics = new Set(samples.map((s) => s.metricType));
    expect(metrics.has('heart_rate')).toBe(true);
    expect(metrics.has('steps')).toBe(true);
    expect(metrics.has('spo2')).toBe(true);
    expect(metrics.has('sleep_duration_min')).toBe(true);
    expect(metrics.has('sleep_efficiency')).toBe(true);

    const sleepDur = samples.find((s) => s.metricType === 'sleep_duration_min');
    const sleepEff = samples.find((s) => s.metricType === 'sleep_efficiency');
    expect(sleepDur?.value).toBeCloseTo(360, 0);
    expect(sleepEff?.value).toBeCloseTo(86, 0);
  });

  it('throws an actionable scope/token error on HTTP 403 from Google Fit aggregate endpoint', async () => {
    const now = Date.now();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Insufficient Permission' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const adapter = new GoogleFitAdapter();
    await expect(
      adapter.fetchRecentSamples({
        externalUserId: 'patient-gfit-403',
        startIso: new Date(now - 24 * 3_600_000).toISOString(),
        endIso: new Date(now).toISOString(),
        accessToken: 'expired-token',
      }),
    ).rejects.toThrow(/reconnect|permissions|403/i);
  });
});

function buildSyntheticSeries(days: number, overrides?: {
  driftStartDay?: number;
  recoveryStartDay?: number;
}): TsSampleInput[] {
  const baseMs = Date.UTC(2026, 10, 1, 0, 0, 0);
  const samples: TsSampleInput[] = [];

  for (let d = 0; d < days; d++) {
    const inDrift =
      overrides?.driftStartDay !== undefined &&
      d >= overrides.driftStartDay &&
      (overrides.recoveryStartDay === undefined || d < overrides.recoveryStartDay);
    const inRecovery = overrides?.recoveryStartDay !== undefined && d >= overrides.recoveryStartDay;
    const driftStep = inDrift ? d - (overrides?.driftStartDay ?? d) + 1 : 0;

    for (let h = 0; h < 24; h++) {
      const iso = new Date(baseMs + (d * 24 + h) * 3_600_000).toISOString();
      const calm = h < 6 || h >= 21;
      const rhrShift = inDrift ? Math.min(26, 8 + driftStep * 5.5) : inRecovery ? 0.5 : 0;
      const spo2Shift = inDrift ? -Math.min(5.2, 1.4 + driftStep * 1.1) : 0;
      const hrVal = 63 + (h % 3) + rhrShift;

      samples.push({
        metricType: 'heart_rate',
        value: hrVal,
        unit: 'bpm',
        recordedAt: iso,
        context: calm ? 'rest' : 'unknown',
        dataConfidence: 0.96,
        isSynthetic: true,
      });

      samples.push({
        metricType: 'spo2',
        value: 97.4 + ((h + d) % 2) * 0.2 + spo2Shift,
        unit: '%',
        recordedAt: iso,
        context: 'rest',
        dataConfidence: 0.85,
        isSynthetic: true,
      });

      if (h >= 8 && h <= 19) {
        samples.push({
          metricType: 'steps',
          value: inDrift ? 70 : 410 + (h % 4) * 35,
          unit: 'steps',
          recordedAt: iso,
          context: 'unknown',
          dataConfidence: 0.98,
          isSynthetic: true,
        });
      }
    }

    const wakeIso = new Date(baseMs + (d * 24 + 7) * 3_600_000).toISOString();
    samples.push({
      metricType: 'sleep_duration_min',
      value: inDrift ? 290 : 435 + (d % 3) * 10,
      unit: 'min',
      recordedAt: wakeIso,
      context: 'sleep',
      dataConfidence: 0.95,
      isSynthetic: true,
    });
    samples.push({
      metricType: 'sleep_efficiency',
      value: inDrift ? 71 : 88,
      unit: '%',
      recordedAt: wakeIso,
      context: 'sleep',
      dataConfidence: 0.95,
      isSynthetic: true,
    });
  }

  return samples;
}

describe('PS2 TypeScript Engine Parity & Synthetic Timeline Lifecycle', () => {
  it('progresses calibration warming_prior (2d) -> learning (7d) -> calibrated (15d) with Empirical Bayes shrinkage and all 4 PS2 metrics', () => {
    const s2 = evaluateLocalDeterministicEngine({
      patientId: 'ps2-cal-2',
      samples: buildSyntheticSeries(2),
      conditions: [],
    });
    expect(s2.baseline.stage).toBe('warming_prior');
    expect(s2.baseline.validDays).toBe(2);

    const s7 = evaluateLocalDeterministicEngine({
      patientId: 'ps2-cal-7',
      samples: buildSyntheticSeries(7),
      conditions: [],
    });
    expect(s7.baseline.stage).toBe('learning');
    expect(s7.baseline.validDays).toBe(7);

    const s15 = evaluateLocalDeterministicEngine({
      patientId: 'ps2-cal-15',
      samples: buildSyntheticSeries(15),
      conditions: [],
    });
    expect(s15.baseline.stage).toBe('calibrated');
    expect(s15.baseline.validDays).toBe(15);

    const metricNames = new Set(s15.baseline.metrics.map((m) => m.metricType));
    expect(metricNames.has('resting_heart_rate')).toBe(true);
    expect(metricNames.has('heart_rate')).toBe(true);
    expect(metricNames.has('steps')).toBe(true);
    expect(metricNames.has('sleep_duration_min')).toBe(true);
    expect(metricNames.has('sleep_efficiency')).toBe(true);
    expect(metricNames.has('spo2')).toBe(true);

    // Personal resting HR median ~64 pulled closer to personal values than prior (66)
    const rhrBase = s15.baseline.metrics.find((m) => m.metricType === 'resting_heart_rate')!;
    expect(rhrBase.median).toBeGreaterThan(62);
    expect(rhrBase.median).toBeLessThan(65.5);

    // Partial NEWS2 must explicitly flag non-wearable fields as unavailable rather than 0
    const unavailable = s15.partialNews2.parameters.filter(
      (p) => p.status === 'unavailable_from_wearable',
    );
    expect(unavailable.length).toBeGreaterThanOrEqual(2);
  });

  it('respects excludedPeriods quarantine and ignores isolated exercise bursts', () => {
    const samples = buildSyntheticSeries(15);
    const day6Start = Date.UTC(2026, 10, 6, 0, 0, 0);
    // Inject extreme illness fever/tachycardia on day 6 inside quarantine span
    for (let h = 0; h < 24; h++) {
      samples.push({
        metricType: 'resting_heart_rate',
        value: 118,
        unit: 'bpm',
        recordedAt: new Date(day6Start + h * 3_600_000).toISOString(),
        context: 'rest',
        dataConfidence: 1,
        isSynthetic: true,
      });
    }
    // Inject pure exercise session at day 10
    samples.push({
      metricType: 'heart_rate',
      value: 142,
      unit: 'bpm',
      recordedAt: new Date(Date.UTC(2026, 10, 10, 17, 0, 0)).toISOString(),
      context: 'exercise',
      dataConfidence: 1,
      isSynthetic: true,
    });

    const evalWithExclusion = evaluateLocalDeterministicEngine({
      patientId: 'ps2-quarantine',
      samples,
      conditions: [],
      exclusions: [
        {
          startsAt: new Date(day6Start).toISOString(),
          endsAt: new Date(day6Start + 24 * 3_600_000).toISOString(),
          reason: 'illness',
        },
      ],
    });
    const rhrBase = evalWithExclusion.baseline.metrics.find(
      (m) => m.metricType === 'resting_heart_rate',
    )!;
    // Quarantined 118 bpm readings & isolated 142 bpm exercise must not pull median up above 67 bpm
    expect(rhrBase.median).toBeLessThan(67);
  });

  it('demonstrates Normal -> Gradual Change -> First Detection -> Confirmed Alert -> Recovery', () => {
    const baselineOnly = evaluateLocalDeterministicEngine({
      patientId: 'ps2-lifecycle',
      samples: buildSyntheticSeries(15),
      conditions: [],
    });
    expect(baselineOnly.level).toBe('stable');
    expect(baselineOnly.deteriorationIndex).toBeLessThan(30);

    const earlyDrift = evaluateLocalDeterministicEngine({
      patientId: 'ps2-lifecycle',
      samples: buildSyntheticSeries(18, { driftStartDay: 15 }),
      conditions: [],
    });
    expect(['watch', 'warning', 'urgent']).toContain(earlyDrift.level);
    expect(earlyDrift.deteriorationIndex).toBeGreaterThanOrEqual(30);
    expect(earlyDrift.l2Score).toBeGreaterThan(25);
    expect(earlyDrift.changePoints.length).toBeGreaterThanOrEqual(1);

    const recovered = evaluateLocalDeterministicEngine({
      patientId: 'ps2-lifecycle',
      samples: buildSyntheticSeries(22, { driftStartDay: 15, recoveryStartDay: 19 }),
      conditions: [],
    });
    expect(recovered.level).toBe('stable');
    expect(recovered.deteriorationIndex).toBeLessThan(earlyDrift.deteriorationIndex);
  });
});
