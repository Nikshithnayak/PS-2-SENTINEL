import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '15s', target: 15 },
    { duration: '30s', target: 30 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:3100';
const API_KEY = __ENV.INGEST_API_KEY || 'snt_live_demo_ramesh_ingest_key_2026';
const PATIENT_ID = __ENV.PATIENT_ID || '11111111-1111-4111-8111-111111111111';

export default function () {
  const health = http.get(`${BASE_URL}/api/health`);
  check(health, { 'healthz 200': (r) => r.status === 200 });

  const payload = JSON.stringify({
    patientId: PATIENT_ID,
    source: 'open_ingest_api',
    idempotencyKey: `k6-${__VU}-${__ITER}`,
    isSynthetic: true,
    samples: [
      {
        metricType: 'resting_heart_rate',
        value: 66 + (__ITER % 5),
        unit: 'bpm',
        recordedAt: new Date(Date.now() - __ITER * 60000).toISOString(),
        context: 'rest',
        source: 'open_ingest_api',
        isSynthetic: true,
      },
    ],
  });

  const ingest = http.post(`${BASE_URL}/api/v1/ingest`, payload, {
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
    },
  });
  check(ingest, { 'ingest 201 or 200': (r) => r.status === 201 || r.status === 200 });
  sleep(0.2);
}
