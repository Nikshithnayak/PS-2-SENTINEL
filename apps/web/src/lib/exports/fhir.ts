import { createHash } from 'node:crypto';
import type { Bundle, BundleEntry, Flag, Observation, Patient } from '@medplum/fhirtypes';

export function pseudonymizeId(patientId: string): string {
  const salt = process.env.COHORT_PSEUDONYM_SALT ?? 'sentinel-research-cohort-2026';
  return `COH-${createHash('sha256').update(`${salt}:${patientId}`).digest('hex').slice(0, 12).toUpperCase()}`;
}

const LOINC_MAP: Record<string, { code: string; display: string }> = {
  heart_rate: { code: '8867-4', display: 'Heart rate' },
  resting_heart_rate: { code: '40443-4', display: 'Resting heart rate' },
  hrv_rmssd: { code: '80404-7', display: 'R-R interval standard deviation (HRV RMSSD)' },
  spo2: { code: '59408-5', display: 'Oxygen saturation in Arterial blood by Pulse oximetry' },
  respiratory_rate: { code: '9279-1', display: 'Respiratory rate' },
  skin_temp_deviation: { code: '8310-5', display: 'Skin temperature deviation' },
  body_temperature: { code: '8310-5', display: 'Body temperature' },
  steps: { code: '41950-7', display: 'Number of steps in 24 hour Measured' },
  systolic_bp: { code: '8480-6', display: 'Systolic blood pressure' },
  weight_kg: { code: '29463-7', display: 'Body weight' },
};

export function buildFhirR4Bundle(params: {
  patientId: string;
  displayCode: string;
  sex: string | null;
  city: string | null;
  isSynthetic: boolean;
  rollups: Array<{
    id: string;
    metricType: string;
    medianVal: number;
    bucketStart: Date;
    isSynthetic: boolean;
  }>;
  alerts: Array<{
    id: string;
    level: string;
    status: string;
    summaryEn: string;
    createdAt: Date;
    isSynthetic: boolean;
  }>;
}): Bundle {
  const entries: BundleEntry[] = [];

  const syntheticTag = params.isSynthetic
    ? [{ system: 'https://sentinel.nitte.local/tags', code: 'SYNTHETIC', display: 'Synthetic Simulation Data' }]
    : [];

  const patientResource: Patient = {
    resourceType: 'Patient',
    id: params.patientId,
    meta: syntheticTag.length ? { tag: syntheticTag } : undefined,
    identifier: [
      {
        system: 'https://sentinel.nitte.local/patient-code',
        value: params.displayCode,
      },
    ],
    gender:
      params.sex === 'female' || params.sex === 'male' || params.sex === 'other'
        ? params.sex
        : 'unknown',
    address: params.city ? [{ city: params.city, country: 'IN' }] : undefined,
  };

  entries.push({
    fullUrl: `urn:uuid:${params.patientId}`,
    resource: patientResource,
  });

  for (const r of params.rollups.slice(0, 60)) {
    const loinc = LOINC_MAP[r.metricType];
    const obs: Observation = {
      resourceType: 'Observation',
      id: r.id,
      status: 'final',
      meta: r.isSynthetic
        ? {
            tag: [
              {
                system: 'https://sentinel.nitte.local/tags',
                code: 'SYNTHETIC',
                display: 'Synthetic Simulation Data',
              },
            ],
          }
        : undefined,
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'vital-signs',
              display: 'Vital Signs',
            },
          ],
        },
      ],
      code: {
        coding: loinc
          ? [
              {
                system: 'http://loinc.org',
                code: loinc.code,
                display: loinc.display,
              },
            ]
          : undefined,
        text: r.metricType,
      },
      subject: { reference: `Patient/${params.patientId}` },
      effectiveDateTime: r.bucketStart.toISOString(),
      valueQuantity: {
        value: Number(r.medianVal.toFixed(2)),
      },
    };
    entries.push({
      fullUrl: `urn:uuid:${r.id}`,
      resource: obs,
    });
  }

  for (const al of params.alerts.slice(0, 20)) {
    const flag: Flag = {
      resourceType: 'Flag',
      id: al.id,
      status: al.status === 'resolved' || al.status === 'auto_resolved' ? 'inactive' : 'active',
      meta: al.isSynthetic
        ? {
            tag: [
              {
                system: 'https://sentinel.nitte.local/tags',
                code: 'SYNTHETIC',
                display: 'Synthetic Simulation Data',
              },
            ],
          }
        : undefined,
      code: {
        coding: [
          {
            system: 'https://sentinel.nitte.local/alert-level',
            code: al.level,
            display: `SENTINEL Early Awareness (${al.level.toUpperCase()})`,
          },
        ],
        text: al.summaryEn,
      },
      subject: { reference: `Patient/${params.patientId}` },
      period: { start: al.createdAt.toISOString() },
    };
    entries.push({
      fullUrl: `urn:uuid:${al.id}`,
      resource: flag,
    });
  }

  return {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: new Date().toISOString(),
    meta: syntheticTag.length ? { tag: syntheticTag } : undefined,
    entry: entries,
  };
}
