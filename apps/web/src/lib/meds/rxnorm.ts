export interface MedicationLookupResult {
  query: string;
  normalizedName: string;
  rxcui: string | null;
  affectsHeartRate: boolean;
  clinicalNote: string;
  source: 'nlm_rxnorm' | 'local_pharmacopeia_reference';
}

const RATE_CONTROL_KEYWORDS = [
  'metoprolol',
  'atenolol',
  'bisoprolol',
  'carvedilol',
  'propranolol',
  'nebivolol',
  'diltiazem',
  'verapamil',
  'digoxin',
  'ivabradine',
];

/**
 * Looks up public standardized medication nomenclature (RxNorm NLM API).
 * ZERO patient PII is sent — only the generic/brand medicine string.
 */
export async function lookupRxNormDrug(medicineName: string): Promise<MedicationLookupResult> {
  const clean = medicineName.trim();
  const lower = clean.toLowerCase();
  const affectsHeartRate = RATE_CONTROL_KEYWORDS.some((kw) => lower.includes(kw));

  try {
    const url = `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(clean)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      const json = (await resp.json()) as {
        drugGroup?: {
          conceptGroup?: Array<{
            conceptProperties?: Array<{ rxcui?: string; name?: string }>;
          }>;
        };
      };
      const firstProp = json.drugGroup?.conceptGroup
        ?.flatMap((g) => g.conceptProperties ?? [])
        .find((p) => p.rxcui && p.name);

      if (firstProp?.rxcui) {
        return {
          query: clean,
          normalizedName: firstProp.name ?? clean,
          rxcui: firstProp.rxcui,
          affectsHeartRate,
          clinicalNote: affectsHeartRate
            ? 'Rate-modifying cardiovascular agent: missed doses may produce rebound resting heart rate spikes.'
            : 'Matched against NLM RxNorm concept registry.',
          source: 'nlm_rxnorm',
        };
      }
    }
  } catch {
    // Offline fallback without failing medication logging
  }

  return {
    query: clean,
    normalizedName: clean,
    rxcui: null,
    affectsHeartRate,
    clinicalNote: affectsHeartRate
      ? 'Rate-modifying agent (beta-blocker / CCB class): missed doses are annotated alongside heart-rate trends.'
      : 'Standard medication entry stored for adherence context overlay.',
    source: 'local_pharmacopeia_reference',
  };
}
