export interface VoiceCheckinAnalysis {
  symptoms: string[];
  severity: 'none' | 'mild' | 'moderate' | 'severe';
  redFlag: boolean;
  replyText: string;
}

const RULES: Array<{
  symptom: string;
  severityWeight: number;
  redFlag?: boolean;
  patterns: RegExp[];
}> = [
  {
    symptom: 'chest_pain',
    severityWeight: 3,
    redFlag: true,
    patterns: [/chest\s*(pain|tightness|pressure|heavy)/i, /ಎದೆ\s*ನೋವು/i, /सीने\s*में\s*दर्द/i],
  },
  {
    symptom: 'breathless',
    severityWeight: 3,
    redFlag: true,
    patterns: [
      /(can'?t|cannot|hard to|short\s*of)\s*breath/i,
      /breathless|gasping/i,
      /ಉಸಿರಾಟದ\s*ತೊಂದರೆ/i,
      /साँस\s*(फूल|लेने\s*में\s*दिक्कत)/i,
    ],
  },
  {
    symptom: 'dizziness',
    severityWeight: 2,
    patterns: [/dizz(y|iness)|lightheaded|faint/i, /ತಲೆ\s*ಸುತ್ತು/i, /चक्कर/i],
  },
  {
    symptom: 'fever',
    severityWeight: 2,
    patterns: [/fever|chills|hot|temperature/i, /ಜ್ವರ/i, /बुखार/i],
  },
  {
    symptom: 'fatigue',
    severityWeight: 1,
    patterns: [/tired|weak|fatigue|sleepy|unwell/i, /ಸುಸ್ತು|ಆಯಾಸ/i, /थकान|कमज़ोर/i],
  },
];

const OK_PATTERN = /\b(i am ok|i'?m ok|feeling (good|fine|okay|well)|fine today|ಚೆನ್ನಾಗಿದ್ದೇನೆ|ठीक हूँ)\b/i;

export function analyzeVoiceCheckin(
  transcript: string,
  locale: 'en' | 'kn' | 'hi' = 'en',
  emergencyNumber = '112',
): VoiceCheckinAnalysis {
  const symptoms: string[] = [];
  let maxWeight = 0;
  let redFlag = false;

  for (const rule of RULES) {
    if (rule.patterns.some((rx) => rx.test(transcript))) {
      symptoms.push(rule.symptom);
      maxWeight = Math.max(maxWeight, rule.severityWeight);
      if (rule.redFlag) redFlag = true;
    }
  }

  if (symptoms.length === 0 && OK_PATTERN.test(transcript)) {
    const replies = {
      en: 'Thank you. I have noted that you feel okay today and kept your care circle reassured.',
      kn: 'ಧನ್ಯವಾದಗಳು. ನೀವು ಇಂದು ಆರಾಮಾಗಿದ್ದೀರಿ ಎಂದು ದಾಖಲಿಸಲಾಗಿದೆ.',
      hi: 'धन्यवाद। मैंने दर्ज कर लिया है कि आप आज ठीक हैं।',
    };
    return {
      symptoms: [],
      severity: 'none',
      redFlag: false,
      replyText: replies[locale],
    };
  }

  if (symptoms.length === 0) {
    const replies = {
      en: 'Thank you for checking in. If you feel tired, feverish, or breathless, please mention those words or tap a symptom below.',
      kn: 'ಮಾತನಾಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು. ಸುಸ್ತು, ಜ್ವರ ಅಥವಾ ಉಸಿರಾಟದ ತೊಂದರೆ ಇದ್ದರೆ ದಯವಿಟ್ಟು ತಿಳಿಸಿ.',
      hi: 'जांच के लिए धन्यवाद। यदि आपको थकान, बुखार या सांस की तकलीफ हो, तो कृपया बताएं।',
    };
    return {
      symptoms: [],
      severity: 'mild',
      redFlag: false,
      replyText: replies[locale],
    };
  }

  if (redFlag) {
    const replies = {
      en: `I heard ${symptoms.join(', ')}. I am notifying your caregiver now. Because these can be serious signs, please sit down and call emergency ${emergencyNumber} right away if severe.`,
      kn: `${symptoms.join(', ')} ಲಕ್ಷಣಗಳು ಕೇಳಿಬಂದಿವೆ. ನಿಮ್ಮ ಆರೈಕೆದಾರರಿಗೆ ಈಗಲೇ ತಿಳಿಸುತ್ತಿದ್ದೇನೆ. ತೀವ್ರವಾಗಿದ್ದರೆ ತಕ್ಷಣ ${emergencyNumber} ಗೆ ಕರೆ ಮಾಡಿ.`,
      hi: `मैंने ${symptoms.join(', ')} सुना है। मैं अभी आपके देखभालकर्ता को सूचित कर रहा हूँ। गंभीर होने पर तुरंत ${emergencyNumber} पर कॉल करें।`,
    };
    return {
      symptoms,
      severity: 'severe',
      redFlag: true,
      replyText: replies[locale],
    };
  }

  const severity = maxWeight >= 2 ? 'moderate' : 'mild';
  const replies = {
    en: `I noted ${symptoms.join(', ')}. Your care circle can see this check-in note right away. Rest safely and drink water if comfortable.`,
    kn: `${symptoms.join(', ')} ದಾಖಲಾಗಿದೆ. ನಿಮ್ಮ ಕುಟುಂಬ ಸದಸ್ಯರಿಗೆ ಈ ಮಾಹಿತಿ ತಕ್ಷಣ ಕಾಣಿಸುತ್ತದೆ.`,
    hi: `${symptoms.join(', ')} दर्ज कर लिया गया है। आपका परिवार इसे अभी देख सकता है।`,
  };
  return {
    symptoms,
    severity,
    redFlag: false,
    replyText: replies[locale],
  };
}
