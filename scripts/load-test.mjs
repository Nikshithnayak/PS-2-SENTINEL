/**
 * Zero-dependency Node 22+ load & latency probe against SENTINEL `/api/health` and `/api/v1/ingest`.
 * Usage: BASE_URL=http://127.0.0.1:3100 node scripts/load-test.mjs
 */

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:3100';
const API_KEY = process.env.INGEST_API_KEY ?? 'snt_live_demo_ramesh_ingest_key_2026';
const PATIENT_ID = process.env.PATIENT_ID ?? '11111111-1111-4111-8111-111111111111';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8);
const TOTAL_REQUESTS = Number(process.env.TOTAL_REQUESTS ?? 40);

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Number(sorted[idx].toFixed(1));
}

async function main() {
  const healthTimes = [];
  const ingestTimes = [];
  let errors = 0;

  let cursor = 0;
  async function worker(workerId) {
    while (cursor < TOTAL_REQUESTS) {
      const idx = cursor++;
      const t0 = performance.now();
      try {
        const hResp = await fetch(`${BASE_URL}/api/health`);
        if (!hResp.ok) errors++;
        healthTimes.push(performance.now() - t0);

        const t1 = performance.now();
        const iResp = await fetch(`${BASE_URL}/api/v1/ingest`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': API_KEY,
          },
          body: JSON.stringify({
            patientId: PATIENT_ID,
            source: 'open_ingest_api',
            idempotencyKey: `load-${Date.now()}-${workerId}-${idx}`,
            isSynthetic: true,
            samples: [
              {
                metricType: 'resting_heart_rate',
                value: 65 + (idx % 6),
                unit: 'bpm',
                recordedAt: new Date(Date.now() - idx * 60_000).toISOString(),
                context: 'rest',
                source: 'open_ingest_api',
                isSynthetic: true,
              },
            ],
          }),
        });
        if (!iResp.ok) {
          if (errors === 0) console.error('First ingest error:', iResp.status, await iResp.text());
          errors++;
        }
        ingestTimes.push(performance.now() - t1);
      } catch {
        errors++;
      }
    }
  }

  const startedAt = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  const totalSec = (performance.now() - startedAt) / 1000;

  healthTimes.sort((a, b) => a - b);
  ingestTimes.sort((a, b) => a - b);

  const summary = {
    baseUrl: BASE_URL,
    concurrency: CONCURRENCY,
    totalPairs: TOTAL_REQUESTS,
    elapsedSeconds: Number(totalSec.toFixed(2)),
    throughputReqPerSec: Number(((TOTAL_REQUESTS * 2) / totalSec).toFixed(1)),
    errorCount: errors,
    healthMs: {
      p50: percentile(healthTimes, 50),
      p95: percentile(healthTimes, 95),
    },
    ingestMs: {
      p50: percentile(ingestTimes, 50),
      p95: percentile(ingestTimes, 95),
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  if (errors > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
