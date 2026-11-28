import { describe, expect, it } from 'vitest';
import {
  classifyConsultationSpeaker,
  parseTranscriptIntoTurns,
} from '@/lib/clinician/diarization';
import {
  extractLiveClinicalPreview,
  OPD_SAMPLE_CONSULTATIONS,
  parseCodeMixedOpdTranscriptDeterministic,
} from '@/lib/clinician/opd-scribe';
import { isWhisperHallucination } from '@/lib/voice/transcript-cleaner';

describe('Ambient Clinical Scribe for Indian OPDs (EN + Kannada + Hindi)', () => {
  it('classifies who is speaking (Doctor vs Patient) instantaneously across mixed English, Kannada & Hindi turns', () => {
    const p1 = classifyConsultationSpeaker(
      'Doctor sahab, do din se thoda chakkar aa raha hai aur subah BP check kiya tha.',
    );
    expect(p1.speaker).toBe('patient');
    expect(p1.languageHint).toContain('HI');

    const p2 = classifyConsultationSpeaker('3 days inda jwara ide, ratri full keemu ide.');
    expect(p2.speaker).toBe('patient');
    expect(p2.languageHint).toContain('KN');

    const d1 = classifyConsultationSpeaker(
      'Examination chest clear, SpO2 97%, BP 128/80 mmHg. Continue Telmisartan 40 mg OD morning before food for 30 days.',
    );
    expect(d1.speaker).toBe('doctor');

    const q = classifyConsultationSpeaker('How long have you had this fever and cough?', {
      previousSpeaker: 'patient',
    });
    expect(q.speaker).toBe('doctor');

    const ans = classifyConsultationSpeaker('Yes, since Tuesday evening.', {
      previousSpeaker: 'doctor',
      previousText: 'How long have you had this fever and cough?',
    });
    expect(ans.speaker).toBe('patient');
  });

  it('diarizes multi-turn unprefixed mixed conversations and extracts live cues cleanly', () => {
    const turns = parseTranscriptIntoTurns(
      [
        '3 days inda jwara mattu keemu ide, Dolo tagondidde.',
        'Chest clear bilaterally, BP 124/80 mmHg, SpO2 98%.',
        'Take Paracetamol 650 mg 1-0-1 after food for 3 days.',
      ].join('\n'),
    );
    expect(turns.length).toBe(3);
    expect(turns[0]?.speaker).toBe('patient');
    expect(turns[1]?.speaker).toBe('doctor');
    expect(turns[2]?.speaker).toBe('doctor');

    const liveCues = extractLiveClinicalPreview(turns);
    expect(liveCues.symptoms).toContain('Fever');
    expect(liveCues.symptoms).toContain('Cough');
    expect(liveCues.medicines.some((m) => m.includes('Paracetamol'))).toBe(true);
  });

  it('structures code-mixed English + Kannada + Hindi viral URI consultations into SOAP, Rx, and multilingual summaries', () => {
    const sample = OPD_SAMPLE_CONSULTATIONS[0]!;
    const out = parseCodeMixedOpdTranscriptDeterministic({
      transcript: sample.transcript,
      languageMix: 'en_kn_hi',
      telemetry: {
        patientName: 'Ramesh Gowda',
        recentRhr: 88,
        recentSpo2: 97,
        latestIndex: 32,
        latestLevel: 'watch',
      },
    });

    expect(out.soapNote.languagesDetected).toContain('English');
    expect(out.soapNote.languagesDetected).toContain('Kannada');
    expect(out.soapNote.chiefComplaint).toMatch(/Fever/i);
    expect(out.soapNote.chiefComplaint).toMatch(/Cough/i);
    expect(out.soapNote.vitalsSummary).toContain('128/80 mmHg');
    expect(out.soapNote.vitalsSummary).toContain('Wearable RHR 88 bpm');

    const drugs = out.prescriptionDraft.map((d) => d.drugName);
    expect(drugs).toContain('Paracetamol (Dolo)');
    expect(drugs).toContain('Cetirizine');
    expect(drugs).toContain('Pantoprazole');

    const pcm = out.prescriptionDraft.find((d) => d.drugName === 'Paracetamol (Dolo)');
    expect(pcm?.strength).toBe('650 mg');
    expect(pcm?.frequency).toBe('1-0-1 (BD)');
    expect(pcm?.timing).toBe('After food');
    expect(pcm?.durationDays).toBe(3);

    expect(out.patientSummary.en).toContain('Paracetamol (Dolo)');
    expect(out.patientSummary.kn).toContain('ತಪಾಸಣೆಯ ಸಾರಾಂಶ');
    expect(out.patientSummary.hi).toContain('परामर्श सारांश');
  });

  it('detects respiratory red flags and chronic cardiometabolic drugs in code-mixed Hindi & Kannada speech', () => {
    const cardioSample = OPD_SAMPLE_CONSULTATIONS[1]!;
    const cardioOut = parseCodeMixedOpdTranscriptDeterministic({
      transcript: cardioSample.transcript,
      languageMix: 'en_hi',
    });

    expect(cardioOut.soapNote.languagesDetected).toContain('Hindi');
    expect(cardioOut.soapNote.investigations).toContain('HbA1c');
    expect(cardioOut.prescriptionDraft.some((d) => d.drugName === 'Telmisartan')).toBe(true);
    expect(cardioOut.prescriptionDraft.some((d) => d.drugName === 'Metformin')).toBe(true);
    expect(cardioOut.prescriptionDraft.some((d) => d.drugName === 'Metoprolol')).toBe(true);

    const respSample = OPD_SAMPLE_CONSULTATIONS[2]!;
    const respOut = parseCodeMixedOpdTranscriptDeterministic({
      transcript: respSample.transcript,
      languageMix: 'en_kn_hi',
    });
    expect(respOut.soapNote.languagesDetected).toContain('Kannada');
    expect(respOut.soapNote.languagesDetected).toContain('Hindi');
    expect(respOut.soapNote.redFlags.length).toBeGreaterThan(0);
    expect(respOut.prescriptionDraft.some((d) => d.drugName === 'Amoxicillin + Clavulanate')).toBe(true);
    expect(respOut.prescriptionDraft.some((d) => d.drugName === 'Salbutamol Inhaler')).toBe(true);
  });

  it('filters isolated Whisper silence hallucinations like "Thank you." while keeping real clinical speech and native KN/HI turns', () => {
    expect(isWhisperHallucination('Thank you.')).toBe(true);
    expect(isWhisperHallucination('Thank you. Thank you.')).toBe(true);
    expect(isWhisperHallucination('Thanks for watching!')).toBe(true);
    expect(isWhisperHallucination('[BLANK_AUDIO]')).toBe(true);
    expect(isWhisperHallucination('Thank you doctor, fever reduced since yesterday.')).toBe(false);

    const knPatient = classifyConsultationSpeaker('ಮೂರು ದಿನದಿಂದ ಜ್ವರ ಮತ್ತು ಕೆಮ್ಮು ಇದೆ');
    expect(knPatient.speaker).toBe('patient');
    expect(knPatient.languageHint).toBe('KN');

    const hiDoctor = classifyConsultationSpeaker(
      'दो दिन तक पैरासिटामोल खाने के बाद लेना है, पानी ज्यादा पिएं।',
    );
    expect(hiDoctor.speaker).toBe('doctor');
    expect(hiDoctor.languageHint).toBe('HI');
  });
});
