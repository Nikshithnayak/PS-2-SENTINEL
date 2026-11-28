export type ConsultationSpeaker = 'doctor' | 'patient';

export interface ConsultationTurn {
  id: string;
  speaker: ConsultationSpeaker;
  confidence: number;
  text: string;
  languageHint: string;
  reasons: string[];
  timestampIso: string;
}

const DOCTOR_CUES: Array<[RegExp, number, string]> = [
  [/\b(?:take|start|continue|stop|avoid|advise|prescribe|order|check|monitor|follow\s*up|review\s+(?:in|after)|report\s+to)\b/i, 2.2, 'clinical instruction'],
  [/\b(?:examination|exam|auscultation|chest\s*clear|bilateral|rhonchi|crep(?:itation)?s|pharyngeal|congestion|pedal\s*edema|cvs\s*s1s2|impression|diagnosis|likely\s+viral|exacerbation)\b/i, 3.0, 'exam / impression'],
  [/\b(?:1-0-1|1-1-1|1-0-0|0-0-1|0-1-0|OD|BD|TDS|TID|QID|HS|SOS)\b/, 3.2, 'dosing regimen'],
  [/\b\d{1,4}(?:\.\d+)?\s*(?:mg|mcg|ml|iu|puffs?)\b/i, 2.4, 'dosage specification'],
  [/\b(?:after\s+food|before\s+food|before\s+breakfast|at\s+bedtime|for\s+\d+\s*(?:days?|weeks?|din|dina)|saline\s+gargles|hydration|spacer)\b/i, 2.5, 'medication timing/duration'],
  [/\b(?:CBC|HbA1c|creatinine|electrolytes|chest\s*x-?ray|ECG|NS1|call\s*112|if\s+SpO2\s+drops)\b/i, 2.8, 'investigations / safety net'],
  [/\b(?:BP\s+\d{2,3}\s*\/\s*\d{2,3}|SpO2\s+\d{2,3}\s*%|RR\s+\d{1,2}|pulse\s+\d{2,3}|PR\s+\d{2,3})\b/i, 2.2, 'recorded exam vitals'],
  [/\b(?:how\s+long|since\s+when|any\s+(?:fever|cough|pain|breathlessness)|yavaga\s+inda|yenu\s+aagide|kab\s+se|kya\s+(?:hua|takleef)|saans\s+lene)\b/i, 2.5, 'history question'],
  [/\b(?:tagoli|maadi|toh\s+lijiye|le\s+lena|khane\s+ke\s+(?:baad|pehle)|oota\s*aadmele|ootada\s*munche)\b/i, 2.4, 'regional instruction'],
  [/(?:ಮಾತ್ರೆ|ಔಷಧಿ|ಊಟದ ನಂತರ|ಊಟಕ್ಕೆ ಮುಂಚೆ|ಬೆಳಿಗ್ಗೆ.*ರಾತ್ರಿ|ತಗೊಳ್ಳಿ|ಕುಡಿಯಿರಿ|ಪರೀಕ್ಷೆ)/, 2.9, 'Kannada clinical instruction'],
  [/(?:दवा|गोली|टैबलेट|पैरासिटामोल|खाने के बाद|खाने से पहले|सुबह शाम|दिन तक|जांच|फॉलोअप|पिएं|पीजिए|लेना है|लेनी है|लीजिए|लें।?$)/, 2.9, 'Hindi clinical instruction'],
  [/\?\s*$/, 1.4, 'interrogative'],
];

const PATIENT_CUES: Array<[RegExp, number, string]> = [
  [/\b(?:doctor|doc|sahab|saab|sir|madam)\b/i, 2.5, 'addressing clinician'],
  [/\b(?:i\s+have|i\s+am|i\s+feel|i\s+felt|i\s+took|i\s+skipped|my\s+(?:bp|sugar|head|chest|stomach)|for\s+\d+\s+days\s+i)\b/i, 2.6, 'first-person symptom report'],
  [/\b(?:nanage|nanna|nanu|naanu|enige|inda\s+.*\bide|aagtide|aagide|tagondidde|illa\s+sir|bandide|gottilla)\b/i, 2.8, 'Kannada patient expression'],
  [/\b(?:mujhe|mera|meri|mere|main|humko|aa\s+raha\s+hai|ho\s+raha\s+hai|lagta\s+hai|badh\s+jaati\s+hai|kiya\s+tha|khatam\s+ho\s+gayi|skip\s+ho\s+gaya)\b/i, 2.8, 'Hindi patient expression'],
  [/\b(?:jwara\s+ide|keemu\s+mattu|sustu\s+kooda\s+ide|kashta\s+aagtide|chakkar\s+aa\s+raha|dard\s+hai|bukhar\s+hai|khansi\s+hai|pet\s+dard|seene\s+mein)\b/i, 2.6, 'reported symptom'],
  [/[\u0C80-\u0CFF].*(?:ಇದೆ|ಆಗುತ್ತಿದೆ|ನೋವು|ಜ್ವರ|ಕೆಮ್ಮು|ಸುಸ್ತು|ತಲೆ|ಉಸಿರಾಟ|ನನಗೆ)/, 2.7, 'Kannada symptom report'],
  [/[\u0900-\u097F].*(?:हूँ|दर्द|बुखार|खांसी|चक्कर|आ रहा|हो रहा|सांस|कमजोरी|मुझे|मेरा|मेरी|तकलीफ)/, 2.8, 'Hindi symptom report'],
  [/\b(?:yes|yeah|no|houdu|illa|haan|nahi|theek\s+hai|paracetamol\s+liya\s+tha|dolo\s+tagondidde)\b/i, 1.5, 'patient response'],
];

export function detectUtteranceLanguageTag(text: string): string {
  const tags: string[] = [];
  const hasKn =
    /[\u0C80-\u0CFF]|\b(?:jwara|keemu|kemmu|tale\s*novu|hotte\s*novu|usirata|sustu|gantalu|inda|ide|aagtide|maadide|oota|ratr?i|tagond|houdu|nanage|kelavu|swalpa)\b/i.test(
      text,
    );
  const hasHi =
    /[\u0900-\u097F]|\b(?:bukhar|khansi|sir\s*dard|pet\s*dard|seene|saans|chakkar|kamzori|subah|shaam|raat|goli|khane|din\s*se|tha|hai|raha|mujhe|sahab|khatam|haan|nahi)\b/i.test(
      text,
    );
  const hasEn = /[a-zA-Z]{2,}/.test(
    text
      .replace(
        /\b(?:jwara|keemu|kemmu|sustu|inda|ide|aagtide|maadide|oota|tagond|houdu|nanage|kelavu|swalpa|bukhar|khansi|seene|saans|chakkar|kamzori|subah|shaam|raat|goli|khane|din|tha|hai|raha|mujhe|sahab|khatam|haan|nahi)\b/gi,
        '',
      ),
  );
  if (hasEn) tags.push('EN');
  if (hasKn) tags.push('KN');
  if (hasHi) tags.push('HI');
  return tags.length > 0 ? tags.join('+') : 'EN';
}

export function classifyConsultationSpeaker(
  utterance: string,
  options?: {
    previousSpeaker?: ConsultationSpeaker;
    previousText?: string;
    manualSpeaker?: 'auto' | ConsultationSpeaker;
  },
): {
  speaker: ConsultationSpeaker;
  confidence: number;
  languageHint: string;
  reasons: string[];
} {
  const raw = utterance.trim();
  const languageHint = detectUtteranceLanguageTag(raw);

  if (options?.manualSpeaker === 'doctor' || options?.manualSpeaker === 'patient') {
    return {
      speaker: options.manualSpeaker,
      confidence: 1.0,
      languageHint,
      reasons: ['manual speaker lock'],
    };
  }

  // Respect explicit prefix if present
  if (/^(?:doctor|dr\.?)\s*:/i.test(raw)) {
    return {
      speaker: 'doctor',
      confidence: 0.99,
      languageHint,
      reasons: ['explicit Doctor prefix'],
    };
  }
  if (/^(?:patient|pt\.?)\s*:/i.test(raw)) {
    return {
      speaker: 'patient',
      confidence: 0.99,
      languageHint,
      reasons: ['explicit Patient prefix'],
    };
  }

  let docScore = 0;
  let patScore = 0;
  const docReasons: string[] = [];
  const patReasons: string[] = [];

  for (const [re, weight, label] of DOCTOR_CUES) {
    if (re.test(raw)) {
      docScore += weight;
      docReasons.push(label);
    }
  }
  for (const [re, weight, label] of PATIENT_CUES) {
    if (re.test(raw)) {
      patScore += weight;
      patReasons.push(label);
    }
  }

  // Question-answer alternation boost when previous utterance was a doctor question
  if (options?.previousSpeaker === 'doctor' && /\?\s*$|since\s+when|how\s+long|kab\s+se|yavaga/i.test(options.previousText ?? '')) {
    patScore += 1.4;
    patReasons.push('reply to clinician prompt');
  } else if (options?.previousSpeaker && docScore === patScore) {
    // Weak conversational alternation when completely neutral
    if (options.previousSpeaker === 'patient') {
      docScore += 0.6;
      docReasons.push('turn alternation');
    } else {
      patScore += 0.6;
      patReasons.push('turn alternation');
    }
  }

  const speaker: ConsultationSpeaker =
    docScore > patScore ? 'doctor' : patScore > docScore ? 'patient' : options?.previousSpeaker === 'patient' ? 'doctor' : 'patient';

  const margin = Math.abs(docScore - patScore);
  const confidence = Math.min(0.98, Math.max(0.55, Number((0.55 + margin * 0.1).toFixed(2))));

  return {
    speaker,
    confidence,
    languageHint,
    reasons: speaker === 'doctor' ? docReasons.slice(0, 3) : patReasons.slice(0, 3),
  };
}

export function stripSpeakerPrefix(text: string): string {
  return text.replace(/^(?:doctor|dr\.?|patient|pt\.?)\s*:\s*/i, '').trim();
}

export function parseTranscriptIntoTurns(transcript: string): ConsultationTurn[] {
  const clean = transcript.trim();
  if (!clean) return [];

  // Split by newlines or explicit Speaker: markers, and split long mixed single lines by sentence boundaries
  const normalized = clean
    .replace(/\s+(?=(?:Doctor|Dr\.?|Patient|Pt\.?)\s*:)/gi, '\n')
    .replace(/([\.!\?])\s+(?=[A-Z\u0900-\u097F\u0C80-\u0CFF])/g, '$1\n');

  const rawLines = normalized
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const turns: ConsultationTurn[] = [];
  const baseTime = Date.now();

  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i]!;
    const prev = turns[turns.length - 1];
    const classified = classifyConsultationSpeaker(line, {
      previousSpeaker: prev?.speaker,
      previousText: prev?.text,
    });
    const textBody = stripSpeakerPrefix(line);
    if (!textBody) continue;

    turns.push({
      id: `turn_${i + 1}`,
      speaker: classified.speaker,
      confidence: classified.confidence,
      text: textBody,
      languageHint: classified.languageHint,
      reasons: classified.reasons,
      timestampIso: new Date(baseTime + i * 1000).toISOString(),
    });
  }

  return turns;
}

export function formatTurnsToTranscript(turns: ConsultationTurn[]): string {
  return turns
    .map((t) => `${t.speaker === 'doctor' ? 'Doctor' : 'Patient'}: ${t.text.trim()}`)
    .join('\n');
}
