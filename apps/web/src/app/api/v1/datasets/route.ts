import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/session';

const FALLBACK_CATALOG = {
  pmdata: {
    name: 'PMData Sports & Lifelogging (Simula)',
    format: 'Fitbit HR/sleep JSON + wellness CSV',
    license: 'CC BY 4.0',
    metrics: 'resting_heart_rate, steps, sleep_duration_min, sleep_efficiency',
  },
  lifesnaps: {
    name: 'LifeSnaps Fitbit Multimodal',
    format: 'Hourly/daily Fitbit JSON/CSV',
    license: 'Zenodo Open Access',
    metrics: 'resting_heart_rate, hrv_rmssd, spo2, steps, sleep_efficiency',
  },
  wesad: {
    name: 'WESAD Wearable Stress & Affect (Empatica E4)',
    format: 'Summary window CSV / BVP-EDA-TEMP',
    license: 'Research non-commercial',
    metrics: 'heart_rate, hrv_rmssd, skin_temp_deviation',
  },
  mmash: {
    name: 'MMASH Multilevel Activity & Sleep (PhysioNet)',
    format: 'RR/Actigraph CSV (beats -> resting HR & RMSSD)',
    license: 'ODbL 1.0',
    metrics: 'heart_rate, hrv_rmssd, steps',
  },
};

export async function GET() {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;

  const engineUrl = process.env.ENGINE_URL ?? 'http://127.0.0.1:8000';
  try {
    const resp = await fetch(`${engineUrl}/v1/datasets`, { signal: AbortSignal.timeout(2500) });
    if (resp.ok) {
      const json = await resp.json();
      return NextResponse.json(json);
    }
  } catch {
    // fallback catalog
  }

  return NextResponse.json({ datasets: FALLBACK_CATALOG });
}
