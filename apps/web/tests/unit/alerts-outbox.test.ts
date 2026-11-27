import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { applyMigrations, closeDb, withSystemDb } from '@/db';
import { ensurePostgresRunning, type LocalPgHandle } from '@/db/local-pg';
import {
  alertDeliveries,
  alerts,
  jobQueue,
  patientProfiles,
  riskAssessments,
} from '@/db/schema';
import { SEED_IDS, seedDatabase } from '@/db/seed';
import {
  applyAlertAction,
  escalateAlerts,
  maybeTriggerAlertFromEvaluation,
} from '@/lib/alerts/outbox';
import {
  computeBoundedSensitivityUpdate,
  evaluateAlertPolicy,
  isWithinQuietHours,
} from '@/lib/alerts/policy';
import {
  isSmsAdapterEnabled,
  resolveEmailFrom,
  resolveInboxWebhookSecret,
  resolveNtfyConfig,
  resolveVapidConfig,
} from '@/lib/alerts/env-config';
import type { EngineEvaluationResult } from '@/lib/engine/client';

let pgHandle: LocalPgHandle;

beforeAll(async () => {
  pgHandle = await ensurePostgresRunning(5437);
  process.env.DATABASE_URL = pgHandle.url;
  await applyMigrations();
  await seedDatabase();
  await withSystemDb(async (tx) => {
    await tx.delete(alertDeliveries).where(eq(alertDeliveries.patientId, SEED_IDS.patientProfileId));
    await tx.delete(alerts).where(eq(alerts.patientId, SEED_IDS.patientProfileId));
    await tx.delete(riskAssessments).where(eq(riskAssessments.patientId, SEED_IDS.patientProfileId));
    await tx.delete(jobQueue);
    await tx
      .update(patientProfiles)
      .set({ sensitivityOffset: 0 })
      .where(eq(patientProfiles.id, SEED_IDS.patientProfileId));
  });
});

afterAll(async () => {
  await closeDb();
  await pgHandle?.stop();
});

const baseEval = (overrides: Partial<EngineEvaluationResult> = {}): EngineEvaluationResult => ({
  patientId: SEED_IDS.patientProfileId,
  assessedAt: new Date().toISOString(),
  modelVersion: 'sentinel-det-v1.0.0',
  engineSource: 'python-engine',
  isSynthetic: true,
  deteriorationIndex: 66.5,
  level: 'warning',
  baseline: {
    patientId: SEED_IDS.patientProfileId,
    totalSpanDays: 17,
    validDays: 16,
    stage: 'calibrated',
    statusLabel: 'Calibrated',
    conditions: ['general_frailty'],
    spo2Scale: 1,
    metrics: [],
  },
  l1Score: 0,
  l2Score: 84,
  l3Score: 58,
  deviceSilent: false,
  hoursSilent: 1.5,
  contributions: [
    {
      metricType: 'resting_heart_rate',
      label: 'Resting Heart Rate',
      unit: 'bpm',
      observed: 82,
      personalMedian: 64,
      normalLow: 58,
      normalHigh: 70,
      zScore: 4.1,
      ewmaZ: 3.4,
      cusum: 4.5,
      direction: 'higher',
      rawContribution: 72,
      sharePct: 60,
      message: 'Resting Heart Rate (82.0 bpm) is higher than your personal normal.',
    },
  ],
  trend72h: [],
  changePoints: [],
  partialNews2: {
    partialScore: 0,
    maxObservablePoints: 9,
    scoredParameterCount: 3,
    totalNews2Parameters: 7,
    spo2Scale: 1,
    disclaimer: 'Subset',
    parameters: [],
  },
  decisionLog: { suppressedConfounders: [], l1Triggers: [], l3Details: {} },
  summaryText: 'Notable changes from your personal normal in Resting Heart Rate.',
  explanationKn: 'ಬದಲಾವಣೆ ಕಂಡುಬಂದಿದೆ.',
  explanationHi: 'बदलाव देखा गया है।',
  ...overrides,
});

describe('Phase 4 Anti-Fatigue Policy, Escalation Ladder & Transactional Outbox', () => {
  it('enforces N-of-M persistence, hysteresis, quiet hours, Urgent bypass, budget, and bounded sensitivity', () => {
    const baseSettings = {
      quietHoursStart: '22:00',
      quietHoursEnd: '06:00',
      timezone: 'UTC',
      dailyAlertBudget: 2,
      sensitivityOffset: 0,
    };

    // 1. N-of-M suppression on isolated watch blip
    const d1 = evaluateAlertPolicy(
      {
        deteriorationIndex: 35,
        level: 'watch',
        l1Score: 0,
        l2Score: 35,
        deviceSilent: false,
        ruleKey: 'deterioration:resting_heart_rate',
        isSynthetic: false,
      },
      baseSettings,
      {
        recentAssessmentLevels: ['stable'],
        recentAlerts24h: [],
        now: new Date('2026-11-25T12:00:00Z'),
      },
    );
    expect(d1.outcome).toBe('suppress');
    expect(d1.reason).toContain('nofm');

    // 2. Quiet hours suppresses non-urgent warning, while Urgent ALWAYS bypasses
    const night = new Date('2026-11-25T23:30:00Z');
    expect(isWithinQuietHours(night, '22:00', '06:00', 'UTC')).toBe(true);
    const nightWarn = evaluateAlertPolicy(
      {
        deteriorationIndex: 62,
        level: 'warning',
        l1Score: 0,
        l2Score: 70,
        deviceSilent: false,
        ruleKey: 'deterioration:resting_heart_rate',
        isSynthetic: false,
      },
      baseSettings,
      { recentAssessmentLevels: ['watch'], recentAlerts24h: [], now: night },
    );
    expect(nightWarn.outcome).toBe('suppress');
    expect(nightWarn.reason).toContain('quiet_hours');

    const nightUrgent = evaluateAlertPolicy(
      {
        deteriorationIndex: 88,
        level: 'urgent',
        l1Score: 86,
        l2Score: 72,
        deviceSilent: false,
        ruleKey: 'deterioration:spo2',
        isSynthetic: false,
      },
      baseSettings,
      { recentAssessmentLevels: [], recentAlerts24h: [], now: night },
    );
    expect(nightUrgent.outcome).toBe('fire');

    // 3. Hysteresis auto-resolve only below 24
    const resolved = evaluateAlertPolicy(
      {
        deteriorationIndex: 21,
        level: 'stable',
        l1Score: 0,
        l2Score: 15,
        deviceSilent: false,
        ruleKey: 'deterioration:resting_heart_rate',
        isSynthetic: false,
      },
      baseSettings,
      {
        recentAssessmentLevels: ['watch'],
        recentAlerts24h: [
          {
            id: 'a1',
            ruleKey: 'deterioration:resting_heart_rate',
            level: 'warning',
            status: 'open',
            createdAt: new Date('2026-11-25T10:00:00Z'),
            snoozedUntil: null,
          },
        ],
        now: new Date('2026-11-25T12:00:00Z'),
      },
    );
    expect(resolved.outcome).toBe('auto_resolve');

    // 4. Bounded sensitivity stays in [-0.25, +0.25]
    let offset = 0;
    for (let i = 0; i < 12; i += 1) {
      offset = computeBoundedSensitivityUpdate(offset, 'false_alarm');
    }
    expect(offset).toBe(-0.25);
  });

  it('creates alert + multi-channel outbox deliveries, escalates steps 1->2->3, and applies bounded feedback', async () => {
    const res = await maybeTriggerAlertFromEvaluation({
      evaluation: baseEval(),
      actorUserId: SEED_IDS.patientUserId,
      bypassPersistence: true,
      now: new Date('2026-11-25T07:00:00.000Z'), // 12:30 IST daytime
    });
    expect(res.outcome).toBe('fire');
    expect(res.alertId).toBeTruthy();

    const deliveries1 = await withSystemDb((tx) =>
      tx.select().from(alertDeliveries).where(eq(alertDeliveries.alertId, res.alertId!)),
    );
    // Step 1 fires both patient + primary caregiver across multiple channels
    expect(deliveries1.length).toBeGreaterThanOrEqual(5);
    expect(deliveries1.some((d) => d.channel === 'in_app' && d.status === 'delivered')).toBe(true);
    expect(deliveries1.some((d) => d.channel === 'email' && d.status === 'captured_local')).toBe(
      true,
    );
    expect(deliveries1.some((d) => d.channel === 'sms_flag' && d.status === 'skipped_flag_disabled')).toBe(
      true,
    );

    // Force escalate step 1 -> 2 -> 3 (clinician)
    const esc2 = await escalateAlerts({ alertId: res.alertId!, forceImmediate: true });
    expect(esc2.alerts[0]?.newStep).toBe(2);
    const esc3 = await escalateAlerts({ alertId: res.alertId!, forceImmediate: true });
    expect(esc3.alerts[0]?.newStep).toBe(3);

    // Acknowledge with false_alarm feedback
    const ack = await applyAlertAction({
      alertId: res.alertId!,
      actorUserId: SEED_IDS.caregiverUserId,
      action: 'acknowledge',
      feedback: 'false_alarm',
      note: 'Morning brisk climb on stairs',
    });
    expect(ack.status).toBe('acknowledged');
    expect(ack.updatedSensitivityOffset).toBe(-0.05);

    // Snooze 2h from acknowledged state, then escalate Step 3 -> Step 4 and test Step 4 re-dispatch + resolve
    const snoozed = await applyAlertAction({
      alertId: res.alertId!,
      actorUserId: SEED_IDS.caregiverUserId,
      action: 'snooze',
      snoozeMinutes: 120,
    });
    expect(snoozed.status).toBe('snoozed');

    const esc4 = await applyAlertAction({
      alertId: res.alertId!,
      actorUserId: SEED_IDS.caregiverUserId,
      action: 'escalate',
    });
    expect(esc4.status).toBe('escalated');
    expect(esc4.escalationStep).toBe(4);

    // Escalate again at Step 4 stays active (re-dispatching emergency step)
    const esc4Repeat = await applyAlertAction({
      alertId: res.alertId!,
      actorUserId: SEED_IDS.caregiverUserId,
      action: 'escalate',
    });
    expect(esc4Repeat.status).toBe('escalated');
    expect(esc4Repeat.escalationStep).toBe(4);

    const resolved = await applyAlertAction({
      alertId: res.alertId!,
      actorUserId: SEED_IDS.caregiverUserId,
      action: 'resolve',
    });
    expect(resolved.status).toBe('resolved');
  });

  it('resolves unified alert & webhook env aliases matching SETUP-NEEDED.md and .env.example', () => {
    const vapidDocEnv = resolveVapidConfig(
      {
        NODE_ENV: 'production',
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'doc-pub-key',
        VAPID_PRIVATE_KEY: 'doc-priv-key',
      } as unknown as NodeJS.ProcessEnv,
      false,
    );
    expect(vapidDocEnv.publicKey).toBe('doc-pub-key');
    expect(vapidDocEnv.privateKey).toBe('doc-priv-key');
    expect(vapidDocEnv.source).toBe('env');

    expect(
      resolveNtfyConfig({ NTFY_TOPIC_URL: 'https://ntfy.sh/sentinel-mangaluru' } as unknown as NodeJS.ProcessEnv),
    ).toEqual({
      baseUrl: 'https://ntfy.sh',
      topic: 'sentinel-mangaluru',
    });
    expect(
      resolveNtfyConfig({ NTFY_TOPIC_URL: 'https://ntfy.example.com/team/alerts' } as unknown as NodeJS.ProcessEnv),
    ).toEqual({
      baseUrl: 'https://ntfy.example.com/team',
      topic: 'alerts',
    });
    expect(
      resolveNtfyConfig({ NTFY_TOPIC_URL: 'https://ntfy.sh/' } as unknown as NodeJS.ProcessEnv),
    ).toEqual({
      baseUrl: 'https://ntfy.sh',
      topic: null,
    });

    expect(
      resolveEmailFrom({ EMAIL_FROM: 'Sachet Care <care@example.org>' } as unknown as NodeJS.ProcessEnv),
    ).toBe('Sachet Care <care@example.org>');
    expect(
      isSmsAdapterEnabled({ ENABLE_SMS_ADAPTER: 'true' } as unknown as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      isSmsAdapterEnabled({ ENABLE_SMS_GATEWAY: 'true' } as unknown as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      isSmsAdapterEnabled({ ENABLE_SMS_ADAPTER: 'false' } as unknown as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      resolveInboxWebhookSecret({
        CLOUDFLARE_INBOX_WEBHOOK_SECRET: 'cf-secret-1',
      } as unknown as NodeJS.ProcessEnv),
    ).toBe('cf-secret-1');
  });
});
