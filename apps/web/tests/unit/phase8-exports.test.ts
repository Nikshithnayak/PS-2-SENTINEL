import { describe, expect, it } from 'vitest';
import { SEED_IDS } from '@/db/seed';
import { buildFhirR4Bundle, pseudonymizeId } from '@/lib/exports/fhir';

describe('Phase 8 Clinical FHIR R4 & De-Identified Cohort Exports', () => {
  it('generates valid FHIR R4 Bundle with LOINC Observations, Flag resources, and SYNTHETIC tag', () => {
    const bundle = buildFhirR4Bundle({
      patientId: SEED_IDS.patientProfileId,
      displayCode: 'PAT-RAMESH',
      sex: 'male',
      city: 'Mangaluru',
      isSynthetic: true,
      rollups: [
        {
          id: 'obs-1',
          metricType: 'resting_heart_rate',
          medianVal: 82.5,
          bucketStart: new Date('2026-11-25T10:00:00Z'),
          isSynthetic: true,
        },
        {
          id: 'obs-2',
          metricType: 'spo2',
          medianVal: 94.0,
          bucketStart: new Date('2026-11-25T10:00:00Z'),
          isSynthetic: true,
        },
      ],
      alerts: [
        {
          id: 'flag-1',
          level: 'warning',
          status: 'open',
          summaryEn: 'Notable change in RHR and SpO2',
          createdAt: new Date('2026-11-25T10:05:00Z'),
          isSynthetic: true,
        },
      ],
    });

    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.meta?.tag?.[0]?.code).toBe('SYNTHETIC');
    expect(bundle.entry?.length).toBe(4);
    const obsEntries = bundle.entry?.filter((e) => e.resource?.resourceType === 'Observation') ?? [];
    expect(obsEntries).toHaveLength(2);
    const rhrObs = obsEntries[0]?.resource as { code?: { coding?: Array<{ code?: string }> } };
    expect(rhrObs.code?.coding?.[0]?.code).toBe('40443-4');
  });

  it('produces deterministic salted pseudonymized study IDs without revealing source UUID', () => {
    const p1 = pseudonymizeId(SEED_IDS.patientProfileId);
    const p2 = pseudonymizeId(SEED_IDS.patientProfileId);
    expect(p1).toBe(p2);
    expect(p1).toMatch(/^COH-[A-F0-9]{12}$/);
    expect(p1).not.toContain(SEED_IDS.patientProfileId.slice(0, 6));
  });
});
