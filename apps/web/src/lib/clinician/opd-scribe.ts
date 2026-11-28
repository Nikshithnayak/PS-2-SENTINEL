import type {
  OpdPatientSummaryData,
  OpdPrescriptionItemData,
  OpdSoapNoteData,
} from '@/db/schema';
import {
  parseTranscriptIntoTurns,
  type ConsultationTurn,
} from '@/lib/clinician/diarization';
import { lookupRxNormDrug } from '@/lib/meds/rxnorm';

export type OpdLanguageMix = 'en_kn_hi' | 'en_kn' | 'en_hi' | 'en';

export interface OpdPatientTelemetryContext {
  patientName?: string;
  ageBand?: string;
  conditions?: string[];
  latestLevel?: string | null;
  latestIndex?: number | null;
  recentRhr?: number | null;
  recentSpo2?: number | null;
  partialNews2Score?: number | null;
  activeMeds?: string[];
}

export interface OpdScribeGenerationResult {
  soapNote: OpdSoapNoteData;
  prescriptionDraft: OpdPrescriptionItemData[];
  patientSummary: OpdPatientSummaryData;
  generatorSource: 'wispr_deterministic_opd';
}

export interface OpdSampleScenario {
  id: string;
  label: string;
  languageMix: OpdLanguageMix;
  patientLabel: string;
  transcript: string;
}

export const OPD_SAMPLE_CONSULTATIONS: OpdSampleScenario[] = [
  {
    id: 'en_kn_viral_uri',
    label: 'EN + Kannada · Fever & Cough (URI)',
    languageMix: 'en_kn_hi',
    patientLabel: 'Ramesh Gowda (64M)',
    transcript:
      'Patient: Doctor, 3 days inda jwara ide, ratri full keemu mattu throat pain, sustu kooda ide. Tablet Dolo tagondidde but still temperature 101.2 F ide. Doctor: Examination: mild pharyngeal congestion, chest clear bilaterally, SpO2 97%, pulse 92 bpm, BP 128/80 mmHg. Acute upper respiratory tract infection likely viral. Take Paracetamol 650 mg 1-0-1 after food for 3 days, Cetirizine 10 mg 0-0-1 at bedtime for 5 days, Pantoprazole 40 mg 1-0-0 before breakfast for 5 days. Warm saline gargles and hydration. Follow up after 3 days or earlier if breathlessness or high fever persists.',
  },
  {
    id: 'en_hi_htn_dm',
    label: 'EN + Hindi · HTN & Diabetes Review',
    languageMix: 'en_hi',
    patientLabel: 'Kamala Devi (68F)',
    transcript:
      'Patient: Doctor sahab, do din se thoda chakkar aa raha hai aur subah BP check kiya toh 154/92 tha. Do din se Telma goli khatam ho gayi thi isliye skip ho gaya. Sugar check kiya fasting 168 mg/dL tha. Doctor: Vitals BP 152/90 mmHg, PR 84 bpm, SpO2 98%, no pedal edema, CVS S1S2 normal. Uncontrolled hypertension and Type 2 DM secondary to missed dose. Continue Telmisartan 40 mg OD morning before food for 30 days, Metformin 500 mg BD after food for 30 days, Metoprolol 25 mg OD morning for 30 days. Order HbA1c, serum creatinine and electrolytes. Review in 14 days with home BP log; call 112 immediately if severe chest pain or giddiness occurs.',
  },
  {
    id: 'en_kn_hi_bronchitis',
    label: 'EN + KN + HI · Cough & Wheeze Red-Flag Check',
    languageMix: 'en_kn_hi',
    patientLabel: 'Abdul Rahman (73M)',
    transcript:
      'Patient: Doctor, kelavu dina inda usirata swalpa kashta aagtide, raat ko khansi badh jaati hai aur seene mein heaviness lagta hai. Doctor: Temp 100.4 F, RR 24/min, SpO2 91% on room air, bilateral rhonchi on auscultation, pulse 104 bpm. Acute infective exacerbation of airway disease / mild hypoxia. Start Amoxyclav 625 mg BD after food for 5 days, Salbutamol 100 mcg inhaler 2 puffs SOS, Pantoprazole 40 mg OD before food for 5 days. Advise CBC, chest X-ray PA view, and strict SpO2 monitoring. If SpO2 drops below 90% or saans phoolna worsens, report to casualty or call 112/108 immediately.',
  },
];

interface SymptomMatcher {
  patterns: RegExp[];
  canonical: string;
  durationHint?: boolean;
  isRedFlag?: boolean;
  redFlagLabel?: string;
}

const SYMPTOM_LEXICON: SymptomMatcher[] = [
  {
    patterns: [/\bfever\b/i, /\bjwara\b/i, /\bbukhar\b/i, /ಜ್ವರ/, /बुखार/],
    canonical: 'Fever',
    durationHint: true,
  },
  {
    patterns: [/\bcough\b/i, /\bkeemu\b/i, /\bkemmu\b/i, /\bkhansi\b/i, /ಕೆಮ್ಮು/, /खांसी/, /खाँसी/],
    canonical: 'Cough',
  },
  {
    patterns: [/\bthroat\s*pain\b/i, /\bsore\s*throat\b/i, /\bgantalu\s*novu\b/i, /\bgale\s*mein\s*dard\b/i, /ಗಂಟಲು ನೋವು/],
    canonical: 'Sore throat',
  },
  {
    patterns: [
      /\bbreathless(?:ness)?\b/i,
      /\bshortness\s+of\s+breath\b/i,
      /\busirata.*kashta\b/i,
      /\bsaans\s*phool/i,
      /\bhypoxia\b/i,
      /ಉಸಿರಾಟ/,
      /सांस/,
    ],
    canonical: 'Breathlessness / dyspnea',
    isRedFlag: true,
    redFlagLabel: 'Respiratory distress / breathlessness reported',
  },
  {
    patterns: [/\bchest\s*pain\b/i, /\bseene\s*mein\s*(?:dard|heaviness)\b/i, /\bede\s*novu\b/i, /ಎದೆ ನೋವು/, /सीने में दर्द/],
    canonical: 'Chest pain / heaviness',
    isRedFlag: true,
    redFlagLabel: 'Chest pain / heaviness reported',
  },
  {
    patterns: [/\bdizz(?:y|iness)\b/i, /\bgiddiness\b/i, /\bchakkar\b/i, /\btaley?\s*suth/i, /ತಲೆ ಸುತ್ತು/, /चक्कर/],
    canonical: 'Dizziness / giddiness',
  },
  {
    patterns: [/\bheadache\b/i, /\btale\s*novu\b/i, /\bsir\s*dard\b/i, /ತಲೆ ನೋವು/, /सिर दर्द/],
    canonical: 'Headache',
  },
  {
    patterns: [/\bfatigue\b/i, /\bweakness\b/i, /\bsustu\b/i, /\bkamzori\b/i, /\bbody\s*pain\b/i, /ಸುಸ್ತು/, /कमजोरी/],
    canonical: 'Fatigue / malaise / body ache',
  },
  {
    patterns: [/\babdominal\s*pain\b/i, /\bhotte\s*novu\b/i, /\bpet\s*(?:dard|mein\s*dard)\b/i, /ಹೊಟ್ಟೆ ನೋವು/, /पेट दर्द/],
    canonical: 'Abdominal discomfort',
  },
  {
    patterns: [/\bvomit(?:ing)?\b/i, /\bvamana\b/i, /\bulti\b/i, /ವಾಂತಿ/, /उल्टी/],
    canonical: 'Vomiting',
  },
  {
    patterns: [/\bskip(?:ped)?\b/i, /\bmissed\s*dose\b/i, /\bkhatam\b/i, /\bbandh\s*kiya\b/i, /ಬಿಟ್ಟಿದ/],
    canonical: 'Missed prior medication dose',
  },
];

interface DrugCatalogEntry {
  canonical: string;
  aliases: RegExp[];
  defaultStrength: string;
  defaultFrequency: string;
  defaultTiming: string;
  route: string;
  defaultDuration: number;
  instructions: string;
}

const INDIAN_OPD_FORMULARY: DrugCatalogEntry[] = [
  {
    canonical: 'Paracetamol (Dolo)',
    aliases: [/\bparacetamol\b/i, /\bdolo\b/i, /\bcrocin\b/i, /\bpcm\b/i],
    defaultStrength: '650 mg',
    defaultFrequency: '1-0-1 (BD)',
    defaultTiming: 'After food',
    route: 'Oral',
    defaultDuration: 3,
    instructions: 'For fever or body pain; maintain at least 6h gap between doses',
  },
  {
    canonical: 'Azithromycin',
    aliases: [/\bazithromycin\b/i, /\bazee\b/i, /\bazithral\b/i],
    defaultStrength: '500 mg',
    defaultFrequency: '1-0-0 (OD)',
    defaultTiming: 'After food',
    route: 'Oral',
    defaultDuration: 3,
    instructions: 'Complete full course at the same time daily',
  },
  {
    canonical: 'Amoxicillin + Clavulanate',
    aliases: [/\bamoxyclav\b/i, /\baugmentin\b/i, /\bamoxicillin\b/i],
    defaultStrength: '625 mg',
    defaultFrequency: '1-0-1 (BD)',
    defaultTiming: 'After food',
    route: 'Oral',
    defaultDuration: 5,
    instructions: 'Complete antibiotic course as prescribed',
  },
  {
    canonical: 'Cetirizine',
    aliases: [/\bcetirizine\b/i, /\bcetzine\b/i, /\blevocetirizine\b/i, /\bmontair\s*lc\b/i],
    defaultStrength: '10 mg',
    defaultFrequency: '0-0-1 (HS)',
    defaultTiming: 'At bedtime',
    route: 'Oral',
    defaultDuration: 5,
    instructions: 'May cause mild drowsiness; prefer bedtime dosing',
  },
  {
    canonical: 'Pantoprazole',
    aliases: [/\bpantoprazole\b/i, /\bpan\s*40\b/i, /\bpan-d\b/i, /\bomez\b/i, /\bomeprazole\b/i],
    defaultStrength: '40 mg',
    defaultFrequency: '1-0-0 (OD)',
    defaultTiming: 'Before breakfast',
    route: 'Oral',
    defaultDuration: 5,
    instructions: 'Take 30 minutes before morning meal',
  },
  {
    canonical: 'Telmisartan',
    aliases: [/\btelmisartan\b/i, /\btelma\b/i],
    defaultStrength: '40 mg',
    defaultFrequency: '1-0-0 (OD)',
    defaultTiming: 'Morning (Before/After food)',
    route: 'Oral',
    defaultDuration: 30,
    instructions: 'Do not skip daily blood pressure dose; monitor home BP',
  },
  {
    canonical: 'Amlodipine',
    aliases: [/\bamlodipine\b/i, /\bamlokind\b/i, /\bstamlo\b/i],
    defaultStrength: '5 mg',
    defaultFrequency: '1-0-0 (OD)',
    defaultTiming: 'Morning',
    route: 'Oral',
    defaultDuration: 30,
    instructions: 'Monitor blood pressure and report ankle swelling if any',
  },
  {
    canonical: 'Metoprolol',
    aliases: [/\bmetoprolol\b/i, /\bbetaloc\b/i, /\bmetolar\b/i, /\batenolol\b/i, /\bbisoprolol\b/i],
    defaultStrength: '25 mg',
    defaultFrequency: '1-0-0 (OD)',
    defaultTiming: 'After breakfast',
    route: 'Oral',
    defaultDuration: 30,
    instructions: 'Rate-controlling beta-blocker; do not stop abruptly without doctor advice',
  },
  {
    canonical: 'Metformin',
    aliases: [/\bmetformin\b/i, /\bglycomet\b/i],
    defaultStrength: '500 mg',
    defaultFrequency: '1-0-1 (BD)',
    defaultTiming: 'After food',
    route: 'Oral',
    defaultDuration: 30,
    instructions: 'Take immediately after meals to avoid gastric upset',
  },
  {
    canonical: 'Glimepiride',
    aliases: [/\bglimepiride\b/i, /\bamaryl\b/i],
    defaultStrength: '1 mg',
    defaultFrequency: '1-0-0 (OD)',
    defaultTiming: 'Before breakfast',
    route: 'Oral',
    defaultDuration: 30,
    instructions: 'Do not skip meals after taking dose to prevent hypoglycemia',
  },
  {
    canonical: 'Atorvastatin',
    aliases: [/\batorvastatin\b/i, /\batorva\b/i, /\brosuvastatin\b/i],
    defaultStrength: '10 mg',
    defaultFrequency: '0-0-1 (HS)',
    defaultTiming: 'At bedtime',
    route: 'Oral',
    defaultDuration: 30,
    instructions: 'Take nightly for lipid management',
  },
  {
    canonical: 'Salbutamol Inhaler',
    aliases: [/\bsalbutamol\b/i, /\basthalin\b/i, /\blevolin\b/i, /\bbudesonide\b/i],
    defaultStrength: '100 mcg (2 puffs)',
    defaultFrequency: 'SOS (As needed)',
    defaultTiming: 'As needed for wheeze',
    route: 'Inhalation',
    defaultDuration: 30,
    instructions: 'Use via spacer if breathless; seek urgent care if relief lasts < 4 hours',
  },
];

function detectLanguagesInTranscript(transcript: string): string[] {
  const langs: string[] = ['English'];
  if (
    /[\u0C80-\u0CFF]|\b(?:jwara|keemu|kemmu|tale\s*novu|hotte\s*novu|usirata|sustu|gantalu|inda|ide|maadide|oota|ratr?i|tagond)\b/i.test(
      transcript,
    )
  ) {
    langs.push('Kannada');
  }
  if (
    /[\u0900-\u097F]|\b(?:bukhar|khansi|sir\s*dard|pet\s*dard|seene|saans|chakkar|kamzori|subah|shaam|raat|goli|khane\s*ke|din\s*se|tha|hai|raha)\b/i.test(
      transcript,
    )
  ) {
    langs.push('Hindi');
  }
  return Array.from(new Set(langs));
}

function extractVitalsMentioned(
  transcript: string,
  telemetry?: OpdPatientTelemetryContext,
): string {
  const parts: string[] = [];
  const bpMatch = transcript.match(/\bBP\s*(?:is|:|=)?\s*(\d{2,3}\s*\/\s*\d{2,3})\s*(?:mmhg)?/i);
  if (bpMatch?.[1]) parts.push(`OPD BP: ${bpMatch[1].replace(/\s+/g, '')} mmHg`);

  const tempMatch = transcript.match(/\b(?:temp(?:erature)?|jwara|bukhar)\s*(?:is|:|=)?\s*(\d{2,3}(?:\.\d)?)\s*(?:°?\s*[CF])?/i);
  if (tempMatch?.[1]) parts.push(`Temp: ${tempMatch[1]}°F`);

  const spo2Match = transcript.match(/\bSpO2\s*(?:is|:|=)?\s*(\d{2,3})\s*%?/i);
  if (spo2Match?.[1]) parts.push(`OPD SpO2: ${spo2Match[1]}%`);

  const hrMatch = transcript.match(/\b(?:HR|pulse|PR)\s*(?:is|:|=)?\s*(\d{2,3})\s*(?:\/?\s*min|bpm)?/i);
  if (hrMatch?.[1]) parts.push(`OPD Pulse: ${hrMatch[1]} bpm`);

  const rrMatch = transcript.match(/\bRR\s*(?:is|:|=)?\s*(\d{1,2})\s*(?:\/?\s*min)?/i);
  if (rrMatch?.[1]) parts.push(`RR: ${rrMatch[1]}/min`);

  const sugarMatch = transcript.match(/\b(?:GRBS|FBS|PPBS|sugar)\s*(?:is|:|=)?\s*(\d{2,3})\s*(?:mg\/dL)?/i);
  if (sugarMatch?.[1]) parts.push(`Blood Glucose: ${sugarMatch[1]} mg/dL`);

  if (telemetry) {
    const tParts: string[] = [];
    if (typeof telemetry.recentRhr === 'number') tParts.push(`Wearable RHR ${Math.round(telemetry.recentRhr)} bpm`);
    if (typeof telemetry.recentSpo2 === 'number') tParts.push(`Wearable SpO2 ${Math.round(telemetry.recentSpo2)}%`);
    if (typeof telemetry.latestIndex === 'number') {
      tParts.push(`SENTINEL Index ${telemetry.latestIndex} (${telemetry.latestLevel ?? 'stable'})`);
    }
    if (typeof telemetry.partialNews2Score === 'number') {
      tParts.push(`Partial NEWS2 ${telemetry.partialNews2Score}`);
    }
    if (tParts.length > 0) parts.push(`SENTINEL Telemetry: ${tParts.join(', ')}`);
  }

  return parts.length > 0
    ? parts.join(' · ')
    : 'No vitals stated in transcript; examine BP, pulse, temperature & SpO2 before signing.';
}

function extractInvestigations(transcript: string): string[] {
  const candidates: Array<[RegExp, string]> = [
    [/\bCBC\b/i, 'CBC (Complete Blood Count)'],
    [/\bHbA1c\b/i, 'HbA1c'],
    [/\bcreatinine\b|\bRFT\b/i, 'Serum Creatinine / RFT'],
    [/\belectrolytes\b/i, 'Serum Electrolytes'],
    [/\bchest\s*x-?ray\b|\bCXR\b/i, 'Chest X-Ray PA view'],
    [/\bECG\b|\bEKG\b/i, '12-Lead ECG'],
    [/\bLFT\b/i, 'Liver Function Test (LFT)'],
    [/\bdengue\b|\bNS1\b/i, 'Dengue NS1 / IgM'],
    [/\bFBS\b|\bPPBS\b|\bGRBS\b/i, 'Fasting / Post-prandial Blood Glucose'],
    [/\burine\s*(?:routine|culture|r\/m)\b/i, 'Urine Routine & Culture'],
  ];
  const found = candidates.filter(([re]) => re.test(transcript)).map(([, label]) => label);
  return Array.from(new Set(found));
}

function parseFrequencyNearMatch(windowText: string, fallback: string): string {
  const numericPattern = windowText.match(/\b([01]\s*-\s*[01]\s*-\s*[01])\b/);
  if (numericPattern?.[1]) {
    const clean = numericPattern[1].replace(/\s+/g, '');
    if (clean === '1-0-1') return '1-0-1 (BD)';
    if (clean === '1-1-1') return '1-1-1 (TDS)';
    if (clean === '1-0-0') return '1-0-0 (OD)';
    if (clean === '0-0-1') return '0-0-1 (HS)';
    return clean;
  }
  if (/\b(?:TDS|TID|thrice)\b/i.test(windowText)) return '1-1-1 (TDS)';
  if (/\b(?:BD|BID|twice|morning\s+and\s+night|subah\s+shaam)\b/i.test(windowText)) return '1-0-1 (BD)';
  if (/\b(?:HS|bedtime|night|raat|ratri)\b/i.test(windowText)) return '0-0-1 (HS)';
  if (/\b(?:OD|once\s+daily|morning|subah|beligge)\b/i.test(windowText)) return '1-0-0 (OD)';
  if (/\b(?:SOS|prn|as\s+needed)\b/i.test(windowText)) return 'SOS (As needed)';
  return fallback;
}

function parseTimingNearMatch(windowText: string, fallback: string): string {
  if (/\bbefore\s+(?:food|meal|breakfast)|empty\s+stomach|ootada\s*munche|khane\s*ke\s*pehle/i.test(windowText)) {
    return 'Before food';
  }
  if (/\bafter\s+(?:food|meal|breakfast|dinner)|oota\s*aadmele|khane\s*ke\s*baad/i.test(windowText)) {
    return 'After food';
  }
  if (/\b(?:bedtime|night|at\s+night|HS)\b/i.test(windowText)) {
    return 'At bedtime';
  }
  if (/\b(?:SOS|as\s+needed)\b/i.test(windowText)) {
    return 'As needed';
  }
  return fallback;
}

function parseDurationNearMatch(windowText: string, fallback: number): number {
  const m = windowText.match(/\b(?:for|x)?\s*(\d{1,2})\s*(?:days?|din|dina|d)\b/i);
  if (m?.[1]) {
    const val = Number.parseInt(m[1], 10);
    if (Number.isFinite(val) && val >= 1 && val <= 90) return val;
  }
  return fallback;
}

function parseStrengthNearMatch(windowText: string, fallback: string): string {
  const m = windowText.match(/\b(\d{1,4}(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu))\b/i);
  if (m?.[1]) {
    return m[1].replace(/\s+/g, ' ').trim();
  }
  return fallback;
}

function extractPrescriptionsDeterministic(transcript: string): Array<DrugCatalogEntry & {
  strength: string;
  frequency: string;
  timing: string;
  durationDays: number;
}> {
  const results: Array<DrugCatalogEntry & {
    strength: string;
    frequency: string;
    timing: string;
    durationDays: number;
  }> = [];

  for (const drug of INDIAN_OPD_FORMULARY) {
    const candidateIndices: number[] = [];
    for (const re of drug.aliases) {
      const globalRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      let m: RegExpExecArray | null;
      while ((m = globalRe.exec(transcript)) !== null) {
        candidateIndices.push(m.index);
      }
    }
    if (candidateIndices.length === 0) continue;

    let bestClause: string | null = null;
    for (const idx of candidateIndices) {
      const windowBefore = transcript.slice(Math.max(0, idx - 25), idx);
      const afterText = transcript.slice(idx, Math.min(transcript.length, idx + 120));
      const clauseTail = afterText.split(/[\.;\n]/)[0] ?? afterText;
      const clause = `${windowBefore}${clauseTail}`;

      // Skip past/missed medication mentions unless paired with active prescribing instructions
      const isPrescribedClause =
        /\b(?:continue|start|take|advise|bd|od|tds|hs|sos|1-0-1|1-0-0|1-1-1|0-0-1|\d+\s*mg|\d+\s*mcg|days?|din)\b/i.test(
          clause,
        );
      const priorOnly =
        /\b(?:khatam|skip(?:ped)?|missed|was\s+taking|had\s+taken|tagondidde)\b/i.test(clause) &&
        !isPrescribedClause;
      if (priorOnly) continue;

      if (isPrescribedClause || bestClause === null) {
        bestClause = clauseTail;
      }
    }

    if (!bestClause) continue;

    results.push({
      ...drug,
      strength: parseStrengthNearMatch(bestClause, drug.defaultStrength),
      frequency: parseFrequencyNearMatch(bestClause, drug.defaultFrequency),
      timing: parseTimingNearMatch(bestClause, drug.defaultTiming),
      durationDays: parseDurationNearMatch(bestClause, drug.defaultDuration),
    });
  }

  return results;
}

function buildMultilingualPatientSummary(params: {
  chiefComplaint: string;
  impression: string;
  rxItems: OpdPrescriptionItemData[];
  followUpWhen: string;
  warningSigns: string[];
  patientName?: string;
}): OpdPatientSummaryData {
  const greetingPrefix = params.patientName ? `${params.patientName}: ` : '';
  const medLinesEn =
    params.rxItems.length > 0
      ? params.rxItems
          .map((m) => `• ${m.drugName} ${m.strength} — ${m.frequency}, ${m.timing} for ${m.durationDays} days`)
          .join('\n')
      : '• Follow supportive care and hydration advised by your doctor.';

  const medLinesKn =
    params.rxItems.length > 0
      ? params.rxItems
          .map(
            (m) =>
              `• ${m.drugName} (${m.strength}) — ${m.frequency}, ${m.timing === 'After food' ? 'ಊಟದ ನಂತರ' : m.timing === 'Before food' || m.timing === 'Before breakfast' ? 'ಊಟಕ್ಕೆ ಮುಂಚೆ' : m.timing} · ${m.durationDays} ದಿನಗಳು`,
          )
          .join('\n')
      : '• ವೈದ್ಯರು ಸೂಚಿಸಿದ ವಿಶ್ರಾಂತಿ ಮತ್ತು ನೀರನ್ನು ಸೇವಿಸಿ.';

  const medLinesHi =
    params.rxItems.length > 0
      ? params.rxItems
          .map(
            (m) =>
              `• ${m.drugName} (${m.strength}) — ${m.frequency}, ${m.timing === 'After food' ? 'खाने के बाद' : m.timing === 'Before food' || m.timing === 'Before breakfast' ? 'खाने से पहले' : m.timing} · ${m.durationDays} दिन`,
          )
          .join('\n')
      : '• डॉक्टर की सलाह अनुसार आराम करें और पर्याप्त पानी पिएं।';

  return {
    en: [
      `${greetingPrefix}Consultation Summary: ${params.chiefComplaint}.`,
      `Clinical impression: ${params.impression}.`,
      `Medicines:\n${medLinesEn}`,
      `Follow-up: ${params.followUpWhen}. Warning signs: return immediately or call 112/108 for ${params.warningSigns.join(', ')}.`,
    ].join('\n'),
    kn: [
      `${greetingPrefix}ತಪಾಸಣೆಯ ಸಾರಾಂಶ: ${params.chiefComplaint}.`,
      `ವೈದ್ಯಕೀಯ ಅಭಿಪ್ರಾಯ: ${params.impression}.`,
      `ಔಷಧಿಗಳು:\n${medLinesKn}`,
      `ಮರುಪರಿಶೀಲನೆ: ${params.followUpWhen}. ಎಚ್ಚರಿಕೆ ಚಿಹ್ನೆಗಳು (ಉಸಿರಾಟದ ತೊಂದರೆ, ಎದೆ ನೋವು ಅಥವಾ ಹೆಚ್ಚಿನ ಜ್ವರ ಕಂಡರೆ) ತಕ್ಷಣ ಆಸ್ಪತ್ರೆಗೆ ಭೇಟಿ ನೀಡಿ ಅಥವಾ 112 / 108 ಗೆ ಕರೆ ಮಾಡಿ.`,
    ].join('\n'),
    hi: [
      `${greetingPrefix}परामर्श सारांश: ${params.chiefComplaint}.`,
      `चिकित्सकीय आकलन: ${params.impression}.`,
      `दवाइयाँ:\n${medLinesHi}`,
      `फॉलो-अप: ${params.followUpWhen}। खतरे के लक्षण (सांस फूलना, सीने में दर्द, या तेज़ बुखार बने रहने पर) तुरंत अस्पताल आएं या 112 / 108 पर कॉल करें।`,
    ].join('\n'),
    followUpWhen: params.followUpWhen,
    warningSigns: params.warningSigns,
  };
}

export function parseCodeMixedOpdTranscriptDeterministic(params: {
  transcript: string;
  languageMix: OpdLanguageMix;
  telemetry?: OpdPatientTelemetryContext;
}): {
  soapNote: OpdSoapNoteData;
  prescriptionDraft: Array<{
    drugName: string;
    strength: string;
    route: string;
    frequency: string;
    timing: string;
    durationDays: number;
    instructions: string;
  }>;
  patientSummary: OpdPatientSummaryData;
} {
  const transcript = params.transcript.trim();
  const langs = detectLanguagesInTranscript(transcript);
  const turns = parseTranscriptIntoTurns(transcript);
  const patientLines = turns.filter((t) => t.speaker === 'patient').map((t) => t.text);
  const doctorLines = turns.filter((t) => t.speaker === 'doctor').map((t) => t.text);
  const rxSourceText = doctorLines.length > 0 ? doctorLines.join('. ') : transcript;

  const symptoms: string[] = [];
  const redFlags: string[] = [];
  for (const s of SYMPTOM_LEXICON) {
    if (s.patterns.some((re) => re.test(transcript))) {
      symptoms.push(s.canonical);
      if (s.isRedFlag && s.redFlagLabel) {
        redFlags.push(s.redFlagLabel);
      }
    }
  }

  const durMatch = transcript.match(/\b(\d{1,2})\s*(?:days?|din|dina)\b/i);
  const durStr = durMatch?.[1] ? ` (${durMatch[1]} day duration mentioned)` : '';

  const chiefComplaint =
    symptoms.length > 0
      ? `${symptoms.slice(0, 4).join(', ')}${durStr}`
      : 'OPD review consultation (verify presenting symptoms directly with patient)';

  const vitalsSummary = extractVitalsMentioned(transcript, params.telemetry);
  const investigations = extractInvestigations(transcript);

  const examFindings: string[] = [];
  if (/\bchest\s*clear\b/i.test(transcript)) examFindings.push('Chest clear bilaterally');
  if (/\brhonchi\b|\bwheeze\b/i.test(transcript)) examFindings.push('Rhonchi / airway wheeze noted on auscultation');
  if (/\bcongestion\b|\berythema\b/i.test(transcript)) examFindings.push('Pharyngeal congestion noted');
  if (/\bno\s*pedal\s*edema\b/i.test(transcript)) examFindings.push('No pedal edema');
  if (/\bS1\s*S2\s*normal\b/i.test(transcript)) examFindings.push('CVS S1S2 normal');

  const objectiveExam =
    examFindings.length > 0
      ? `${examFindings.join('; ')}. ${vitalsSummary}`
      : `${vitalsSummary}. Other systemic physical exam elements not explicitly verbalized — complete hands-on exam before approval.`;

  let impression = 'Acute outpatient presentation — clinician confirmation required';
  if (/airway|wheeze|rhonchi|bronchitis|hypoxia/i.test(transcript) || (symptoms.includes('Breathlessness / dyspnea') && symptoms.includes('Cough'))) {
    impression = 'Acute infective respiratory exacerbation / lower airway symptoms — assess oxygenation closely';
  } else if (symptoms.includes('Fever') && (symptoms.includes('Cough') || symptoms.includes('Sore throat'))) {
    impression = 'Acute Upper Respiratory Tract Infection (likely viral) vs early febrile illness';
  } else if (/hypertension|telmisartan|\bBP\b/i.test(transcript) || /diabetes|metformin|\bsugar\b/i.test(transcript)) {
    impression = 'Chronic Cardiometabolic Review (Hypertension / Diabetes management & adherence review)';
  }

  const rawFollowUp = transcript.match(/\b(?:follow\s*up|review)\s*(?:in|after)?\s*(\d{1,2}\s*(?:days?|weeks?|din))/i);
  const followUpWhen = rawFollowUp?.[1] ? `After ${rawFollowUp[1]}` : redFlags.length > 0 ? '24–48 hours (or immediate ER if worsening)' : '3–5 days if symptoms persist';

  const rxMatched = extractPrescriptionsDeterministic(rxSourceText);
  const rxRaw = rxMatched.map((r) => ({
    drugName: r.canonical,
    strength: r.strength,
    route: r.route,
    frequency: r.frequency,
    timing: r.timing,
    durationDays: r.durationDays,
    instructions: r.instructions,
  }));

  const warningSigns = [
    'SpO2 < 92% or worsening breathlessness',
    'chest pain or fainting/dizziness',
    'persistent high fever beyond 72 hours',
  ];

  const planParts = [
    rxRaw.length > 0
      ? `Drafted ${rxRaw.length} prescription item(s) for clinician verification.`
      : 'Supportive / symptomatic regimen — add prescription medicines as indicated.',
    investigations.length > 0 ? `Investigations advised: ${investigations.join(', ')}.` : null,
    `Follow-up: ${followUpWhen}.`,
    'Safety net: educate patient & caregiver on 112/108 red-flag warning signs.',
  ].filter(Boolean);

  const hpiSource = patientLines.length > 0 ? patientLines.join(' ') : transcript;
  const soapNote: OpdSoapNoteData = {
    chiefComplaint,
    subjectiveHpi: `Patient-reported history (${langs.join(' + ')}): "${hpiSource.slice(0, 340)}${hpiSource.length > 340 ? '…' : ''}"`,
    objectiveExam,
    vitalsSummary,
    assessment: `${impression}${redFlags.length > 0 ? ` [RED FLAG: ${redFlags.join('; ')}]` : ''}`,
    planAndFollowUp: planParts.join(' '),
    languagesDetected: langs,
    redFlags,
    investigations,
  };

  const placeholderRx: OpdPrescriptionItemData[] = rxRaw.map((r) => ({
    ...r,
    rxcui: null,
    affectsHeartRate: false,
  }));

  const patientSummary = buildMultilingualPatientSummary({
    chiefComplaint,
    impression,
    rxItems: placeholderRx,
    followUpWhen,
    warningSigns,
    patientName: params.telemetry?.patientName,
  });

  return { soapNote, prescriptionDraft: rxRaw, patientSummary };
}

export interface LiveOpdCues {
  symptoms: string[];
  redFlags: string[];
  vitals: string[];
  medicines: string[];
  languages: string[];
}

/**
 * Synchronous sub-millisecond extraction used in the live browser feed as Doctor & Patient speak.
 */
export function extractLiveClinicalPreview(turns: ConsultationTurn[]): LiveOpdCues {
  const full = turns.map((t) => t.text).join('\n');
  if (!full.trim()) {
    return { symptoms: [], redFlags: [], vitals: [], medicines: [], languages: [] };
  }

  const symptoms: string[] = [];
  const redFlags: string[] = [];
  for (const s of SYMPTOM_LEXICON) {
    if (s.patterns.some((re) => re.test(full))) {
      symptoms.push(s.canonical);
      if (s.isRedFlag && s.redFlagLabel) redFlags.push(s.redFlagLabel);
    }
  }

  const vitalsStr = extractVitalsMentioned(full);
  const vitals = vitalsStr.startsWith('No vitals') ? [] : vitalsStr.split(' · ');

  const docText = turns
    .filter((t) => t.speaker === 'doctor')
    .map((t) => t.text)
    .join('. ');
  const rx = extractPrescriptionsDeterministic(docText || full);

  return {
    symptoms,
    redFlags,
    vitals,
    medicines: rx.map((r) => `${r.canonical} ${r.strength} (${r.frequency})`),
    languages: detectLanguagesInTranscript(full),
  };
}

/**
 * Structures an Indian OPD doctor-patient consultation (code-mixed English + Kannada + Hindi)
 * into a SOAP clinical note, RxNorm-checked draft prescription, and multilingual patient summary
 * deterministically without calling external LLMs.
 */
export async function generateOpdScribeDraft(params: {
  transcript: string;
  languageMix?: OpdLanguageMix;
  telemetry?: OpdPatientTelemetryContext;
}): Promise<OpdScribeGenerationResult> {
  const mix: OpdLanguageMix = params.languageMix ?? 'en_kn_hi';
  const deterministic = parseCodeMixedOpdTranscriptDeterministic({
    transcript: params.transcript,
    languageMix: mix,
    telemetry: params.telemetry,
  });

  // Enrich every Rx medicine with RxNorm CUI + rate-control heart-rate safety check
  const enrichedRx: OpdPrescriptionItemData[] = await Promise.all(
    deterministic.prescriptionDraft.map(async (item) => {
      const rx = await lookupRxNormDrug(item.drugName);
      return {
        drugName: rx.normalizedName || item.drugName,
        strength: item.strength,
        route: item.route,
        frequency: item.frequency,
        timing: item.timing,
        durationDays: item.durationDays,
        instructions: item.instructions,
        rxcui: rx.rxcui,
        affectsHeartRate: rx.affectsHeartRate,
      };
    }),
  );

  const patientSummary = buildMultilingualPatientSummary({
    chiefComplaint: deterministic.soapNote.chiefComplaint,
    impression: deterministic.soapNote.assessment,
    rxItems: enrichedRx,
    followUpWhen: deterministic.patientSummary.followUpWhen,
    warningSigns: deterministic.patientSummary.warningSigns,
    patientName: params.telemetry?.patientName,
  });

  return {
    soapNote: deterministic.soapNote,
    prescriptionDraft: enrichedRx,
    patientSummary,
    generatorSource: 'wispr_deterministic_opd',
  };
}
