export type VoiceIntent =
  | 'greeting'
  | 'feeling_okay'
  | 'question_vitals'
  | 'symptom'
  | 'red_flag'
  | 'general_conversation';

export interface VoiceConversationContext {
  patientFirstName?: string;
  latestLevel?: string | null;
  latestIndex?: number | null;
  latestExplanation?: string | null;
  recentHeartRate?: number | null;
  recentSpo2?: number | null;
  activeMeds?: string[];
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
}

export interface VoiceCheckinAnalysis {
  intent: VoiceIntent;
  shouldLogCheckin: boolean;
  symptoms: string[];
  severity: 'none' | 'mild' | 'moderate' | 'severe';
  redFlag: boolean;
  replyText: string;
}

interface SymptomRule {
  symptom: string;
  severityWeight: number;
  redFlag?: boolean;
  patterns: RegExp[];
  advice: {
    en: string;
    kn: string;
    hi: string;
  };
}

const RULES: SymptomRule[] = [
  {
    symptom: 'chest_pain',
    severityWeight: 3,
    redFlag: true,
    patterns: [
      /chest\s*(pain|tightness|pressure|heavy|ache|burning)/i,
      /pain\s*(in|on)\s*(my\s*)?chest/i,
      /ಎದೆ\s*ನೋವು/i,
      /सीने\s*में\s*दर्द/i,
    ],
    advice: {
      en: 'Please sit or rest upright immediately, avoid exertion, and seek urgent medical help.',
      kn: 'ದಯವಿಟ್ಟು ತಕ್ಷಣ ಕುಳಿತು ವಿಶ್ರಾಂತಿ ಪಡೆಯಿರಿ ಮತ್ತು ತುರ್ತು ವೈದ್ಯಕೀಯ ಸಹಾಯ ಪಡೆಯಿರಿ.',
      hi: 'कृपया तुरंत बैठ जाएं, आराम करें और तुरंत चिकित्सा सहायता लें।',
    },
  },
  {
    symptom: 'breathless',
    severityWeight: 3,
    redFlag: true,
    patterns: [
      /(can'?t|cannot|hard to|short\s*of|trouble|difficulty)\s*breath(e|ing)?/i,
      /breathless|gasping|wheez(e|ing)|suffocating/i,
      /ಉಸಿರಾಟದ\s*ತೊಂದರೆ|ಉಸಿರುಗಟ್ಟ/i,
      /साँस\s*(फूल|लेने\s*में\s*दिक्कत|तकलीफ)/i,
    ],
    advice: {
      en: 'Sit upright, loosen tight clothing, and get medical attention right away if breathing feels hard.',
      kn: 'ನೇರವಾಗಿ ಕುಳಿತುಕೊಳ್ಳಿ, ಬಿಗಿಯಾದ ಬಟ್ಟೆ ಸಡಿಲಗೊಳಿಸಿ ಮತ್ತು ತಕ್ಷಣ ವೈದ್ಯಕೀಯ ಸಹಾಯ ಪಡೆಯಿರಿ.',
      hi: 'सीधे बैठें, तंग कपड़े ढीले करें और तुरंत चिकित्सा सहायता लें।',
    },
  },
  {
    symptom: 'neuro_emergency',
    severityWeight: 3,
    redFlag: true,
    patterns: [
      /(blacked?\s*out|unconscious|passed\s*out|slurr(ed|ing)\s*speech|face\s*droop|numbness\s*(on\s*)?(one|left|right)\s*side)/i,
      /ಪ್ರಜ್ಞೆ\s*ತಪ್ಪಿ/i,
      /बेहोश|ज़बान\s*लड़खड़ा/i,
    ],
    advice: {
      en: 'These warning signs require immediate medical evaluation — stay still and seek urgent help right away.',
      kn: 'ಈ ಲಕ್ಷಣಗಳಿಗೆ ತಕ್ಷಣ ತುರ್ತು ವೈದ್ಯಕೀಯ ತಪಾಸಣೆ ಅಗತ್ಯವಿದೆ.',
      hi: 'इन लक्षणों के लिए तुरंत आपातकालीन चिकित्सा जांच आवश्यक है।',
    },
  },
  {
    symptom: 'fall_risk',
    severityWeight: 2,
    patterns: [
      /\b(fell|fallen|fall\s*down|slipped|tripped)\b/i,
      /ಬಿದ್ದೆ|ಜಾರಿ/i,
      /गिर\s*(गया|गयी|पड़ा|पड़ी)/i,
    ],
    advice: {
      en: 'Did you hurt your head, hip, or joints, and are you able to move comfortably right now? Let your caregiver check on you before standing quickly.',
      kn: 'ನೀವು ಬಿದ್ದಾಗ ತಲೆ ಅಥವಾ ಕೈಕಾಲುಗಳಿಗೆ ಏನಾದರೂ ಪೆಟ್ಟಾಗಿದೆಯೇ? ದಯವಿಟ್ಟು ತಕ್ಷಣ ಎದ್ದೇಳಲು ಪ್ರಯತ್ನಿಸಬೇಡಿ.',
      hi: 'क्या गिरने से सिर या जोड़ों में चोट आई है? कृपया जल्दी उठने की कोशिश न करें और परिवार को देखने दें।',
    },
  },
  {
    symptom: 'dizziness',
    severityWeight: 2,
    patterns: [
      /dizz(y|iness)|lightheaded|vertigo|spinning|wobbly|giddy/i,
      /ತಲೆ\s*ಸುತ್ತು/i,
      /चक्कर/i,
    ],
    advice: {
      en: 'Please sit down slowly so you stay safe from falling, sip water gradually, and tell me if this started suddenly when standing up.',
      kn: 'ದಯವಿಟ್ಟು ನಿಧಾನವಾಗಿ ಕುಳಿತುಕೊಳ್ಳಿ ಮತ್ತು ಸ್ವಲ್ಪ ನೀರು ಕುಡಿಯಿರಿ. ಎದ್ದು ನಿಂತಾಗ ಹೀಗಾಗುತ್ತಿದೆಯೇ?',
      hi: 'कृपया धीरे से बैठ जाएं ताकि गिरने का खतरा न रहे, और थोड़ा पानी पिएं। क्या खड़े होने पर ऐसा हो रहा है?',
    },
  },
  {
    symptom: 'fever',
    severityWeight: 2,
    patterns: [
      /fever|chills|shiver(ing)?|high\s*temp(erature)?|feeling\s*hot/i,
      /ಜ್ವರ|ಚಳಿ/i,
      /बुखार|ठंड\s*लग/i,
    ],
    advice: {
      en: 'Stay hydrated, rest lightly dressed, and check your temperature if a thermometer is nearby. Do you also have body aches, cough, or chills?',
      kn: 'ಸಾಕಷ್ಟು ನೀರು ಕುಡಿಯಿರಿ ಮತ್ತು ವಿಶ್ರಾಂತಿ ಪಡೆಯಿರಿ. ಜೊತೆಗೆ ಮೈಕೈ ನೋವು ಅಥವಾ ಕೆಮ್ಮು ಇದೆಯೇ?',
      hi: 'पर्याप्त पानी पिएं, आराम करें और संभव हो तो तापमान नापें। क्या साथ में शरीर दर्द या खांसी भी है?',
    },
  },
  {
    symptom: 'headache',
    severityWeight: 1,
    patterns: [/headache|head\s*(ache|pain|hurts|throbbing)|migraine/i, /ತಲೆ\s*ನೋವು/i, /सिर\s*(दर्द|में\s*दर्द)/i],
    advice: {
      en: 'Rest your eyes in a calm, softly lit spot and sip some water. If you monitor blood pressure at home, checking BP safely helps rule out spikes — has the headache lasted long?',
      kn: 'ಶಾಂತವಾದ ಸ್ಥಳದಲ್ಲಿ ವಿಶ್ರಾಂತಿ ಪಡೆಯಿರಿ ಮತ್ತು ನೀರು ಕುಡಿಯಿರಿ. ಬಿಪಿ ಪರೀಕ್ಷಿಸಲು ಸಾಧ್ಯವಾದರೆ ನೋಡಿ — ಎಷ್ಟು ಹೊತ್ತಿನಿಂದ ತಲೆ ನೋವಿದೆ?',
      hi: 'शांत कम रोशनी में आराम करें और पानी पिएं। यदि घर पर बीपी मशीन है तो जांच करना मददगार रहेगा — यह दर्द कब से है?',
    },
  },
  {
    symptom: 'joint_pain',
    severityWeight: 1,
    patterns: [
      /(knee|joint|back|neck|shoulder|leg|arm|hip|muscle|body|wrist|ankle|foot|feet)\s*(ache|pain|paining|hurts|hurting|stiff|sore)/i,
      /\b(hurts|hurting|paining|aching|body\s*ache|cramps?)\b/i,
      /ನೋವು|ಮೂಳೆ|ಮಂಡಿ/i,
      /दर्द|घुटने|जोड़ों/i,
    ],
    advice: {
      en: 'Take weight off the sore area and rest comfortably; a gentle warm or cool compress may soothe stiffness unless there was an injury. Did this start after movement or an injury?',
      kn: 'ನೋವಿರುವ ಭಾಗಕ್ಕೆ ವಿಶ್ರಾಂತಿ ಕೊಡಿ. ಗಾಯವಾಗದಿದ್ದರೆ ಬಿಸಿ ಅಥವಾ ತಣ್ಣನೆಯ ಶಾಖ ಸ್ವಲ್ಪ ಆರಾಮ ನೀಡಬಹುದು.',
      hi: 'दर्द वाले हिस्से को आराम दें। अगर चोट नहीं लगी है तो हल्की सिकाई आराम दे सकती है। क्या यह अचानक शुरू हुआ?',
    },
  },
  {
    symptom: 'stomach_gi',
    severityWeight: 1,
    patterns: [
      /stomach|tummy|abdomen|belly|acidity|gas|indigestion|nausea|vomit|diarrh(ea|oea)|loose\s*motion|bloat|constipat/i,
      /ಹೊಟ್ಟೆ|ವಾಂತಿ|ಭೇದಿ|ಅಜೀರ್ಣ/i,
      /पेट|एसिडिटी|उल्टी|दस्त|गैस/i,
    ],
    advice: {
      en: 'Take small slow sips of plain water or ORS rather than large meals right now. Are you having any vomiting, fever, or severe cramps?',
      kn: 'ಈಗ ಸ್ವಲ್ಪ ಸ್ವಲ್ಪವಾಗಿ ನೀರು ಅಥವಾ ಒಆರ್‌ಎಸ್ ಕುಡಿಯಿರಿ ಮತ್ತು ಹಗುರ ಆಹಾರ ಸೇವಿಸಿ. ವಾಂತಿ ಅಥವಾ ತೀವ್ರ ನೋವು ಇದೆಯೇ?',
      hi: 'अभी एक साथ खाने के बजाय धीरे-धीरे पानी या ओआरएस लें। क्या आपको उल्टी या तेज मरोड़ भी है?',
    },
  },
  {
    symptom: 'respiratory_mild',
    severityWeight: 1,
    patterns: [
      /cough|cold|sore\s*throat|runny\s*nose|sneez|congestion|phlegm|mucus/i,
      /ಕೆಮ್ಮು|ಶೀತ|ಗಂಟಲು/i,
      /खांसी|जुकाम|गले\s*में\s*खराश|सर्दी/i,
    ],
    advice: {
      en: 'Warm water sips or steam often ease throat irritation. Let me know right away if you start feeling breathless or run a fever.',
      kn: 'ಬಿಸಿ ನೀರು ಕುಡಿಯುವುದು ಗಂಟಲಿಗೆ ಹಿತವಾಗಬಹುದು. ಉಸಿರಾಟದ ತೊಂದರೆ ಅಥವಾ ಜ್ವರ ಕಂಡುಬಂದರೆ ತಕ್ಷಣ ತಿಳಿಸಿ.',
      hi: 'गुनगुना पानी या भाप गले को आराम दे सकता है। यदि सांस फूलने लगे या बुखार आए तो तुरंत बताएं।',
    },
  },
  {
    symptom: 'sleep_issue',
    severityWeight: 1,
    patterns: [
      /(couldn'?t|can'?t|hard\s*to|trouble|unable\s*to|didn'?t)\s*sleep/i,
      /insomnia|bad\s*sleep|poor\s*sleep|awake\s*all\s*night|restless\s*night/i,
      /ನಿದ್ರೆ/i,
      /नींद\s*नहीं/i,
    ],
    advice: {
      en: 'Poor sleep can raise fatigue and resting heart rate the next day. Was something specific waking you up—like pain, coughing, or needing the restroom?',
      kn: 'ನಿದ್ರೆ ಸರಿಯಾಗಿಲ್ಲದಿದ್ದರೆ ಮರುದಿನ ಸುಸ್ತು ಆಗಬಹುದು. ನೋವು ಅಥವಾ ಕೆಮ್ಮಿನಿಂದ ಎಚ್ಚರವಾಗುತ್ತಿತ್ತೇ?',
      hi: 'नींद पूरी न होने से अगले दिन थकान महसूस हो सकती है। क्या दर्द या किसी तकलीफ की वजह से नींद टूटी?',
    },
  },
  {
    symptom: 'blood_sugar',
    severityWeight: 2,
    patterns: [
      /(low|high)\s*(blood\s*)?sugar|glucose|shaky|shakiness|cold\s*sweat|diabetic/i,
      /ಸಕ್ಕರೆ/i,
      /शुगर|ब्लड\s*शुगर/i,
    ],
    advice: {
      en: 'If you have a glucose meter nearby, please check your blood sugar right away—especially if you feel shaky or sweaty—and let your caregiver see this update.',
      kn: 'ಹತ್ತಿರದಲ್ಲಿ ಗ್ಲುಕೋಸ್ ಮೀಟರ್ ಇದ್ದರೆ ದಯವಿಟ್ಟು ಈಗಲೇ ಶುಗರ್ ಪರೀಕ್ಷಿಸಿ.',
      hi: 'यदि पास में शुगर जांचने की मशीन है तो कृपया अभी जांच करें और परिवार को इस अपडेट के बारे में बताएं।',
    },
  },
  {
    symptom: 'blood_pressure',
    severityWeight: 2,
    patterns: [
      /(high|low)\s*(blood\s*pressure|\bbp\b)|\bbp\b\s*(is\s*)?(high|low|up|down)/i,
      /ರಕ್ತದೊತ್ತಡ|ಬಿಪಿ/i,
      /बीपी|ब्लड\s*प्रेशर/i,
    ],
    advice: {
      en: 'Please sit quietly for 5 minutes with both feet flat before taking another blood pressure reading. Share the numbers if you have them and watch for severe headache or chest discomfort.',
      kn: '5 ನಿಮಿಷ ಶಾಂತವಾಗಿ ಕುಳಿತು ಮತ್ತೊಮ್ಮೆ ಬಿಪಿ ಪರೀಕ್ಷಿಸಿ. ತೀವ್ರ ತಲೆನೋವು ಅಥವಾ ಎದೆ ಭಾರವಿದ್ದರೆ ತಕ್ಷಣ ತಿಳಿಸಿ.',
      hi: 'कृपया 5 मिनट शांत बैठकर दोबारा बीपी नापें। यदि बहुत तेज सिरदर्द या सीने में भारीपन हो तो तुरंत बताएं।',
    },
  },
  {
    symptom: 'swelling',
    severityWeight: 2,
    patterns: [/swell(ing)?|swollen|puffy\s*(feet|ankles|legs)|edema/i, /ಊತ/i, /सूजन/i],
    advice: {
      en: 'I noted the swelling and alerted your care circle view. Elevating your legs slightly while seated can help comfort; tell me if breathing also feels harder lying flat.',
      kn: 'ಊತದ ಬಗ್ಗೆ ದಾಖಲಿಸಲಾಗಿದೆ. ಕುಳಿತಾಗ ಕಾಲುಗಳನ್ನು ಸ್ವಲ್ಪ ಎತ್ತರದಲ್ಲಿ ಇಡುವುದು ಆರಾಮದಾಯಕವಾಗಬಹುದು.',
      hi: 'सूजन की जानकारी दर्ज कर ली गई है। बैठते समय पैरों को हल्का ऊंचा रखना आराम दे सकता है। क्या लेटने पर सांस में दिक्कत होती है?',
    },
  },
  {
    symptom: 'medication_concern',
    severityWeight: 1,
    patterns: [
      /(forgot|missed|skipped|ran\s*out\s*of|confusion\s*about)\s*(my\s*)?(med|medicine|medicines|medication|tablet|tablets|pill|pills|dose)/i,
      /ಮಾತ್ರೆ\s*(ಮರೆತ|ಬಿಟ್ಟ)/i,
      /दवाई|गोली\s*(भूल|छूट)/i,
    ],
    advice: {
      en: 'Do not take a double dose automatically—follow your doctor’s missed-dose instructions or check Today’s Medication schedule with your caregiver.',
      kn: 'ಒಟ್ಟಿಗೆ ಎರಡು ಮಾತ್ರೆಗಳನ್ನು ತೆಗೆದುಕೊಳ್ಳಬೇಡಿ — ನಿಮ್ಮ ವೈದ್ಯರ ಸಲಹೆ ಅಥವಾ ಆರೈಕೆದಾರರೊಂದಿಗೆ ಪರಿಶೀಲಿಸಿ.',
      hi: 'एक साथ दो खुराक न लें — अपने डॉक्टर की सलाह या आज की दवा सूची देखकर देखभालकर्ता से पूछें।',
    },
  },
  {
    symptom: 'mood_lonely',
    severityWeight: 1,
    patterns: [
      /anxious|anxiety|worried|scared|afraid|lonely|sad|upset|stressed|down/i,
      /ಆತಂಕ|ಭಯ|ಬೇಸರ/i,
      /चिंता|घबराहट|अकेला|उदास|डर/i,
    ],
    advice: {
      en: 'I’m right here with you. Take three slow deep breaths in and out, and would you like me to ping your caregiver so they can give you a call for a friendly chat?',
      kn: 'ನಾನು ನಿಮ್ಮೊಂದಿಗಿದ್ದೇನೆ. ನಿಧಾನವಾಗಿ ದೀರ್ಘ ಉಸಿರು ತೆಗೆದುಕೊಳ್ಳಿ. ನಿಮ್ಮ ಕುಟುಂಬದವರಿಗೆ ಕರೆ ಮಾಡಲು ತಿಳಿಸಬೇಕೇ?',
      hi: 'मैं आपके साथ हूँ। तीन बार गहरी सांस लें और छोड़ें — क्या मैं आपके परिवार को बात करने के लिए संदेश भेज दूँ?',
    },
  },
  {
    symptom: 'fatigue',
    severityWeight: 1,
    patterns: [
      /tired|weak|fatigue|exhausted|low\s*energy|drained|unwell|not\s*feeling\s*well|sick/i,
      /ಸುಸ್ತು|ಆಯಾಸ|ಬಲಹೀನ/i,
      /थकान|कमज़ोर|कमजोर|तबीयत\s*ठीक\s*नहीं/i,
    ],
    advice: {
      en: 'Listen to your body and take a proper rest break, sip water, and eat light nourishment. Has this tiredness come with dizziness or fever?',
      kn: 'ದಯವಿಟ್ಟು ಸ್ವಲ್ಪ ವಿಶ್ರಾಂತಿ ಪಡೆಯಿರಿ ಮತ್ತು ನೀರು ಕುಡಿಯಿರಿ. ಜೊತೆಗೆ ತಲೆಸುತ್ತು ಅಥವಾ ಜ್ವರ ಇದೆಯೇ?',
      hi: 'थोड़ा आराम करें, पानी पिएं और हल्का भोजन लें। क्या थकान के साथ चक्कर या बुखार भी महसूस हो रहा है?',
    },
  },
];

const GREETING_PATTERN =
  /^\s*(hello|hi|hey|hai|namaste|namaskara|good\s*(morning|afternoon|evening)|ಹಲೋ|ನಮಸ್ಕಾರ|नमस्ते|हेलो|हाय|सुप्रभात)[\s,!?.]*(\s+(how\s+are\s+you|there|sachet|sentinel|friend))?[\s,!?.]*$/i;

const THANKS_BYE_PATTERN =
  /\b(thank\s*you|thanks|ty|bye|goodbye|good\s*night|see\s*you|take\s*care|ಧನ್ಯವಾದ|धन्यवाद|शुक्रिया|अलविदा)\b/i;

const QUESTION_VITALS_PATTERN =
  /(how\s*(am\s*i|are\s*my|is\s*my)|check\s*(my)?|what\s*(is|are)\s*my|vitals|readings|heart\s*rate|oxygen|spo2|status|baseline|summary|who\s*are\s*you|what\s*can\s*you\s*do)/i;

const OK_PATTERN =
  /\b(i\s*am\s*ok(ay)?|i'?m\s*ok(ay)?|feeling\s*(good|fine|okay|ok|great|better|well)|all\s*(good|fine|well)|fine\s*today|doing\s*(good|fine|well|okay)|ಚೆನ್ನಾಗಿದ್ದೇನೆ|ಆರಾಮಾಗಿದ್ದೇನೆ|ठीक\s*हूँ|बढ़िया\s*हूँ)\b/i;

function firstNameLabel(ctx?: VoiceConversationContext): string {
  return ctx?.patientFirstName?.trim() ? ` ${ctx.patientFirstName.trim()}` : '';
}

function buildVitalsSnapshotSentence(
  ctx: VoiceConversationContext | undefined,
  locale: 'en' | 'kn' | 'hi',
): string {
  const parts: string[] = [];
  if (typeof ctx?.recentHeartRate === 'number') {
    parts.push(`resting/recent heart rate ${Math.round(ctx.recentHeartRate)} bpm`);
  }
  if (typeof ctx?.recentSpo2 === 'number') {
    parts.push(`oxygen saturation ${Math.round(ctx.recentSpo2)}%`);
  }
  const hasScore = ctx?.latestLevel && typeof ctx?.latestIndex === 'number';

  if (!hasScore && parts.length === 0) {
    if (locale === 'kn') {
      return 'ಇನ್ನೂ ಯಾವುದೇ ವಾಚ್ ಅಥವಾ ಫೋನ್ ಮಾಪನಗಳು ಸಿಂಕ್ ಆಗಿಲ್ಲ. Watch ಪುಟದಲ್ಲಿ Google Fit ಅಥವಾ Bluetooth ಸಂಪರ್ಕಿಸಿದರೆ ನಾನು ಅವುಗಳನ್ನು ಇಲ್ಲಿಯೇ ತಿಳಿಸುತ್ತೇನೆ.';
    }
    if (locale === 'hi') {
      return 'अभी तक कोई वॉच या फोन रीडिंग सिंक नहीं हुई है। Watch पेज से Google Fit या Bluetooth जोड़ने के बाद मैं आपकी रीडिंग यहीं बता पाऊँगा।';
    }
    return 'No smartwatch or phone readings have synced yet. Once you connect Google Fit, Health Connect, or Bluetooth on the Watch page, I can share your latest trends right here.';
  }

  const metricSummary = parts.length > 0 ? ` Latest sensors show ${parts.join(' and ')}.` : '';
  const statusWord = ctx?.latestLevel ?? 'steady';
  const indexPart =
    typeof ctx?.latestIndex === 'number' ? ` (personal index ${ctx.latestIndex})` : '';

  if (locale === 'kn') {
    return `ನಿಮ್ಮ ಇತ್ತೀಚಿನ ಸ್ಥಿತಿ "${statusWord}"${indexPart} ಎಂದು ಕಾಣುತ್ತಿದೆ.${metricSummary ? ` (${parts.join(', ')})` : ''} ಇದು ವೈಯಕ್ತಿಕ ಬದಲಾವಣೆಗಳ ಮಾಹಿತಿ ಮಾತ್ರ.`;
  }
  if (locale === 'hi') {
    return `आपकी ताज़ा स्थिति "${statusWord}"${indexPart} दिख रही है।${metricSummary ? ` (${parts.join(', ')})` : ''} यह केवल शुरुआती देखभाल जानकारी है।`;
  }
  return `Right now your personal trend looks "${statusWord}"${indexPart}.${metricSummary} Remember this tracks personal shifts for early awareness rather than diagnosing.`;
}

export function analyzeVoiceCheckin(
  transcript: string,
  locale: 'en' | 'kn' | 'hi' = 'en',
  emergencyNumber = '112',
  context?: VoiceConversationContext,
): VoiceCheckinAnalysis {
  const clean = transcript.trim();
  const matchedRules: SymptomRule[] = [];
  let maxWeight = 0;
  let redFlag = false;

  for (const rule of RULES) {
    if (rule.patterns.some((rx) => rx.test(clean))) {
      matchedRules.push(rule);
      maxWeight = Math.max(maxWeight, rule.severityWeight);
      if (rule.redFlag) redFlag = true;
    }
  }

  const symptoms = matchedRules.map((r) => r.symptom);
  const nameTag = firstNameLabel(context);

  // 1. Urgent clinical red flags always take highest safety priority
  if (redFlag) {
    const firstAdvice = matchedRules[0]?.advice[locale] ?? '';
    const replies = {
      en: `I heard ${symptoms.join(', ').replaceAll('_', ' ')}. I am alerting your caregiver immediately. Because this can be urgent, ${firstAdvice} Call emergency ${emergencyNumber} right away if severe.`,
      kn: `${symptoms.join(', ')} ಲಕ್ಷಣಗಳು ಕೇಳಿಬಂದಿವೆ. ನಿಮ್ಮ ಆರೈಕೆದಾರರಿಗೆ ಈಗಲೇ ತಿಳಿಸುತ್ತಿದ್ದೇನೆ. ${firstAdvice} ತೀವ್ರವಾಗಿದ್ದರೆ ತಕ್ಷಣ ${emergencyNumber} ಗೆ ಕರೆ ಮಾಡಿ.`,
      hi: `मैंने ${symptoms.join(', ')} सुना है। मैं अभी आपके देखभालकर्ता को सूचित कर रहा हूँ। ${firstAdvice} गंभीर होने पर तुरंत ${emergencyNumber} पर कॉल करें।`,
    };
    return {
      intent: 'red_flag',
      shouldLogCheckin: true,
      symptoms,
      severity: 'severe',
      redFlag: true,
      replyText: replies[locale],
    };
  }

  // 2. Any reported problem/symptom gets tailored empathetic advice + follow-up
  if (matchedRules.length > 0) {
    const severity = maxWeight >= 2 ? 'moderate' : 'mild';
    const adviceParts = matchedRules.slice(0, 2).map((r) => r.advice[locale]);
    const labelList = symptoms.map((s) => s.replaceAll('_', ' ')).join(', ');
    const replies = {
      en: `Thanks for telling me about ${labelList}.${nameTag ? ` I'm here to help${nameTag}.` : ''} ${adviceParts.join(' ')} I have also saved this note for your care circle.`,
      kn: `${labelList} ಬಗ್ಗೆ ತಿಳಿಸಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು. ${adviceParts.join(' ')} ಈ ಮಾಹಿತಿಯನ್ನು ನಿಮ್ಮ ಕುಟುಂಬದವರಿಗೆ ದಾಖಲಿಸಲಾಗಿದೆ.`,
      hi: `${labelList} के बारे में बताने के लिए धन्यवाद। ${adviceParts.join(' ')} यह जानकारी आपके परिवार के लिए दर्ज कर ली गई है।`,
    };
    return {
      intent: 'symptom',
      shouldLogCheckin: true,
      symptoms,
      severity,
      redFlag: false,
      replyText: replies[locale],
    };
  }

  // 3. Explicit "I feel okay / good" wellness check-in
  if (OK_PATTERN.test(clean)) {
    const replies = {
      en: `That is wonderful to hear${nameTag}! I have logged that you are feeling well today so your care circle stays reassured. Tell me anytime if you need anything else.`,
      kn: `ತುಂಬಾ ಸಂತೋಷ${nameTag}! ನೀವು ಇಂದು ಚೆನ್ನಾಗಿದ್ದೀರಿ ಎಂದು ದಾಖಲಿಸಲಾಗಿದೆ. ಬೇರೆ ಏನಾದರೂ ಸಹಾಯ ಬೇಕಿದ್ದರೆ ಮಾತನಾಡಿ.`,
      hi: `यह सुनकर बहुत अच्छा लगा${nameTag}! मैंने दर्ज कर लिया है कि आप आज ठीक हैं। कुछ भी और बात करनी हो तो बेझिझक बोलें।`,
    };
    return {
      intent: 'feeling_okay',
      shouldLogCheckin: true,
      symptoms: [],
      severity: 'none',
      redFlag: false,
      replyText: replies[locale],
    };
  }

  // 4. Greetings ("Hello", "Hi", "Namaste", "Good morning")
  if (GREETING_PATTERN.test(clean)) {
    const replies = {
      en: `Hello${nameTag}! Good to hear from you. How are you feeling right now — are you comfortable today, or is any pain, dizziness, or anything else bothering you?`,
      kn: `ನಮಸ್ಕಾರ${nameTag}! ಇಂದು ನೀವು ಹೇಗಿದ್ದೀರಿ? ಆರಾಮಾಗಿದ್ದೀರಾ, ಅಥವಾ ಯಾವುದೇ ನೋವು, ತಲೆಸುತ್ತು ಇದೆಯೇ ಹೇಳಿ.`,
      hi: `नमस्ते${nameTag}! आज आप कैसे हैं? क्या आप आराम महसूस कर रहे हैं, या कोई दर्द, चक्कर या परेशानी है?`,
    };
    return {
      intent: 'greeting',
      shouldLogCheckin: false,
      symptoms: [],
      severity: 'none',
      redFlag: false,
      replyText: replies[locale],
    };
  }

  // 5. Gratitude / sign-off
  if (THANKS_BYE_PATTERN.test(clean)) {
    const replies = {
      en: `You're welcome${nameTag}! Take gentle care, stay hydrated, and tap Speak whenever you want to chat or check in.`,
      kn: `ಧನ್ಯವಾದಗಳು${nameTag}! ಆರೋಗ್ಯವನ್ನು ಕಾಪಾಡಿಕೊಳ್ಳಿ, ಯಾವಾಗ ಬೇಕಾದರೂ ಮತ್ತೆ ಮಾತನಾಡಿ.`,
      hi: `आपका स्वागत है${nameTag}! अपना ध्यान रखें, पानी पीते रहें और जब चाहें तब मुझसे बात करें।`,
    };
    return {
      intent: 'greeting',
      shouldLogCheckin: false,
      symptoms: [],
      severity: 'none',
      redFlag: false,
      replyText: replies[locale],
    };
  }

  // 6. Questions about vitals, status, or medications
  if (QUESTION_VITALS_PATTERN.test(clean)) {
    const vitalsText = buildVitalsSnapshotSentence(context, locale);
    const medsText =
      context?.activeMeds && context.activeMeds.length > 0
        ? locale === 'kn'
          ? ` ನಿಮ್ಮ ಸಕ್ರಿಯ ಔಷಧಿಗಳು: ${context.activeMeds.join(', ')}.`
          : locale === 'hi'
            ? ` आपकी सक्रिय दवाइयाँ: ${context.activeMeds.join(', ')}.`
            : ` Your active medications listed today are ${context.activeMeds.join(', ')}.`
        : '';
    return {
      intent: 'question_vitals',
      shouldLogCheckin: false,
      symptoms: [],
      severity: 'none',
      redFlag: false,
      replyText: `${vitalsText}${medsText}`,
    };
  }

  // 6.5 Multi-turn follow-up continuity using conversation history
  const lastAssistant = [...(context?.history ?? [])]
    .reverse()
    .find((h) => h.role === 'assistant');
  const notifyCaregiverRequested =
    /\b(yes|yeah|yep|please|sure|ok|okay)\b.*\b(notify|tell|alert|ping|caregiver|family|call)\b/i.test(
      clean,
    ) ||
    (/^(yes|yeah|yep|please\s*do|sure)$/i.test(clean) &&
      Boolean(lastAssistant?.text.match(/notify|ping|alert your caregiver/i)));

  if (notifyCaregiverRequested) {
    const replies = {
      en: `Done${nameTag} — I have logged your request and notified your care circle view so your caregiver can check in with you.`,
      kn: `ಖಂಡಿತ${nameTag} — ನಿಮ್ಮ ಕುಟುಂಬದವರಿಗೆ ಈಗಲೇ ಮಾಹಿತಿ ಕಳುಹಿಸಲಾಗಿದೆ.`,
      hi: `ठीक है${nameTag} — मैंने आपके परिवार को सूचित कर दिया है ताकि वे आपसे बात कर सकें।`,
    };
    return {
      intent: 'symptom',
      shouldLogCheckin: true,
      symptoms: ['caregiver_callback_requested'],
      severity: 'mild',
      redFlag: false,
      replyText: replies[locale],
    };
  }

  const shortFollowupMatch =
    clean.length <= 70 &&
    lastAssistant &&
    /^(yes|yeah|no|not\s*really|since\s+|yesterday|today|this\s+morning|a\s+little|getting\s+(better|worse)|after\s+)/i.test(
      clean,
    );
  if (shortFollowupMatch) {
    const replies = {
      en: `Got it${nameTag} — thank you for sharing that detail ("${clean}"). Keep resting comfortably, stay hydrated, and let me know right away if discomfort increases or if you'd like me to alert your caregiver.`,
      kn: `ಸರಿ${nameTag} — "${clean}" ಎಂದು ತಿಳಿಸಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು. ದಯವಿಟ್ಟು ವಿಶ್ರಾಂತಿ ಪಡೆಯಿರಿ, ತೊಂದರೆ ಹೆಚ್ಚಾದರೆ ತಿಳಿಸಿ.`,
      hi: `समझ गया${nameTag} — "${clean}" बताने के लिए धन्यवाद। आराम करें और यदि तकलीफ बढ़े या परिवार को बताना हो तो तुरंत कहें।`,
    };
    return {
      intent: 'general_conversation',
      shouldLogCheckin: false,
      symptoms: [],
      severity: 'none',
      redFlag: false,
      replyText: replies[locale],
    };
  }

  // 7. Natural open-ended conversational reflection for ANY custom topic/problem
  const snippet = clean.length > 90 ? `${clean.slice(0, 87)}...` : clean;
  const openReplies = {
    en: `I hear you${nameTag} — you mentioned "${snippet}". Could you share a little more about how that is making you feel physically right now, or let me know if you'd like me to alert your caregiver?`,
    kn: `ನೀವು "${snippet}" ಎಂದು ಹೇಳಿದ್ದು ಕೇಳಿಸಿತು. ಇದರಿಂದ ನಿಮಗೆ ದೈಹಿಕವಾಗಿ ಏನಾದರೂ ತೊಂದರೆ ಆಗುತ್ತಿದೆಯೇ, ಅಥವಾ ನಿಮ್ಮ ಕುಟುಂಬದವರಿಗೆ ತಿಳಿಸಬೇಕೇ?`,
    hi: `मैंने सुना कि आपने "${snippet}" कहा। क्या इसकी वजह से आपको कोई शारीरिक तकलीफ हो रही है, या आप चाहते हैं कि मैं आपके परिवार को इस बारे में बताऊँ?`,
  };
  return {
    intent: 'general_conversation',
    shouldLogCheckin: false,
    symptoms: [],
    severity: 'none',
    redFlag: false,
    replyText: openReplies[locale],
  };
}
