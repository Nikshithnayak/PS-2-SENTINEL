import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { applyMigrations, closeDb, withSystemDb } from '@/db';
import { ensurePostgresRunning, type LocalPgHandle } from '@/db/local-pg';
import { medicationEvents, medications } from '@/db/schema';
import { SEED_IDS, seedDatabase } from '@/db/seed';
import { parseCaregiverReplyCommand } from '@/lib/alerts/reply-parser';
import { lookupRxNormDrug } from '@/lib/meds/rxnorm';
import { analyzeVoiceCheckin } from '@/lib/voice/parser';

let pgHandle: LocalPgHandle;

beforeAll(async () => {
  pgHandle = await ensurePostgresRunning(5439);
  process.env.DATABASE_URL = pgHandle.url;
  await applyMigrations();
  await seedDatabase();
});

afterAll(async () => {
  await closeDb();
  await pgHandle?.stop();
});

describe('Phase 7 Voice Check-In Parser, Caregiver Reply Commands & RxNorm Meds', () => {
  it('parses multilingual greetings, everyday problems, vitals questions, and red-flag symptoms naturally', () => {
    const helloRes = analyzeVoiceCheckin('Hello!', 'en', '112', { patientFirstName: 'Ramesh' });
    expect(helloRes.intent).toBe('greeting');
    expect(helloRes.shouldLogCheckin).toBe(false);
    expect(helloRes.redFlag).toBe(false);
    expect(helloRes.replyText).toMatch(/Hello Ramesh/i);

    const kneeRes = analyzeVoiceCheckin('My knee has been hurting since morning', 'en');
    expect(kneeRes.intent).toBe('symptom');
    expect(kneeRes.symptoms).toContain('joint_pain');
    expect(kneeRes.shouldLogCheckin).toBe(true);
    expect(kneeRes.redFlag).toBe(false);
    expect(kneeRes.replyText.toLowerCase()).toContain('joint pain');

    const vitalsRes = analyzeVoiceCheckin('How is my heart rate?', 'en', '112', {
      latestLevel: 'stable',
      latestIndex: 12,
      recentHeartRate: 68,
      recentSpo2: 98,
    });
    expect(vitalsRes.intent).toBe('question_vitals');
    expect(vitalsRes.shouldLogCheckin).toBe(false);
    expect(vitalsRes.replyText).toContain('68 bpm');
    expect(vitalsRes.replyText).toContain('98%');

    const customRes = analyzeVoiceCheckin('The weather is very humid today', 'en');
    expect(customRes.intent).toBe('general_conversation');
    expect(customRes.shouldLogCheckin).toBe(false);
    expect(customRes.replyText).toContain('The weather is very humid today');

    const okRes = analyzeVoiceCheckin('I am fine today', 'en');
    expect(okRes.severity).toBe('none');
    expect(okRes.redFlag).toBe(false);
    expect(okRes.shouldLogCheckin).toBe(true);

    const redEn = analyzeVoiceCheckin('Having chest tightness and short of breath', 'en', '112');
    expect(redEn.redFlag).toBe(true);
    expect(redEn.severity).toBe('severe');
    expect(redEn.replyText).toContain('112');

    const knFever = analyzeVoiceCheckin('ನನಗೆ ಜ್ವರ ಮತ್ತು ತಲೆ ಸುತ್ತು ಇದೆ', 'kn');
    expect(knFever.symptoms).toContain('fever');
    expect(knFever.symptoms).toContain('dizziness');

    const hiRed = analyzeVoiceCheckin('सीने में दर्द हो रहा है', 'hi', '112');
    expect(hiRed.redFlag).toBe(true);
  });

  it('parses Cloudflare Email & Telegram reply commands identically', () => {
    expect(parseCaregiverReplyCommand('OK\n> quoted line')).toBe('acknowledge');
    expect(parseCaregiverReplyCommand('CALL ME urgently')).toBe('escalate');
    expect(parseCaregiverReplyCommand('/snooze')).toBe('snooze');
    expect(parseCaregiverReplyCommand('random note')).toBeNull();
  });

  it('flags rate-modifying beta-blockers and persists medication adherence events', async () => {
    const info = await lookupRxNormDrug('Metoprolol');
    expect(info.affectsHeartRate).toBe(true);

    const medId = await withSystemDb(async (tx) => {
      const [m] = await tx
        .insert(medications)
        .values({
          patientId: SEED_IDS.patientProfileId,
          name: info.normalizedName,
          rxcui: info.rxcui,
          dosage: '25 mg',
          scheduleTimes: ['08:00'],
          affectsHeartRate: info.affectsHeartRate,
          active: true,
        })
        .returning({ id: medications.id });

      await tx.insert(medicationEvents).values({
        medicationId: m!.id,
        patientId: SEED_IDS.patientProfileId,
        status: 'missed',
        scheduledAt: new Date(),
      });
      return m!.id;
    });

    const events = await withSystemDb((tx) =>
      tx.select().from(medicationEvents).where(eq(medicationEvents.medicationId, medId)),
    );
    expect(events[0]?.status).toBe('missed');
  });
});
