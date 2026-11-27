import { NextResponse, type NextRequest } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog, withSystemDb } from '@/db';
import {
  alerts,
  checkinEvents,
  medications,
  patientProfiles,
  riskAssessments,
  user,
  vitalSamples,
} from '@/db/schema';
import { publishPatientEvent } from '@/lib/alerts/events';
import { processOutboxBatch } from '@/lib/alerts/outbox';
import { getAccessiblePatientIds } from '@/lib/dashboard/queries';
import { checkPatientScope, requireSession } from '@/lib/session';
import { generateConversationalVoiceReply } from '@/lib/voice/companion';

const VoiceCheckinSchema = z.object({
  patientId: z.string().uuid().optional(),
  transcript: z.string().min(1).max(1500),
  locale: z.enum(['en', 'kn', 'hi']).default('en'),
  channel: z.enum(['web_voice', 'open_llm_vtuber']).default('web_voice'),
  isSynthetic: z.boolean().default(false),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(1500),
      }),
    )
    .max(12)
    .optional(),
});

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const raw = await request.json().catch(() => null);
  const parsed = VoiceCheckinSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid voice check-in transcript' }, { status: 400 });
  }

  const accessible = await getAccessiblePatientIds(ctx);
  const patientId = parsed.data.patientId ?? accessible[0];
  if (!patientId) return NextResponse.json({ error: 'patientId required' }, { status: 400 });

  const canCheckin =
    (await checkPatientScope(ctx, patientId, 'checkin_view')) ||
    (await checkPatientScope(ctx, patientId, 'vitals_read'));
  if (!canCheckin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const patientCtx = await withSystemDb(async (tx) => {
    const [profileRow] = await tx
      .select({
        emergencyNumber: patientProfiles.emergencyNumber,
        conditionModules: patientProfiles.conditionModules,
        ownerName: user.name,
      })
      .from(patientProfiles)
      .innerJoin(user, eq(patientProfiles.userId, user.id))
      .where(eq(patientProfiles.id, patientId))
      .limit(1);

    const [latestRisk] = await tx
      .select({
        level: riskAssessments.level,
        deteriorationIndex: riskAssessments.deteriorationIndex,
        explanationEn: riskAssessments.explanationEn,
      })
      .from(riskAssessments)
      .where(eq(riskAssessments.patientId, patientId))
      .orderBy(desc(riskAssessments.assessedAt))
      .limit(1);

    const [latestHr] = await tx
      .select({ value: vitalSamples.value })
      .from(vitalSamples)
      .where(
        and(eq(vitalSamples.patientId, patientId), eq(vitalSamples.metricType, 'resting_heart_rate')),
      )
      .orderBy(desc(vitalSamples.recordedAt))
      .limit(1);

    const [fallbackHr] = latestHr
      ? [latestHr]
      : await tx
          .select({ value: vitalSamples.value })
          .from(vitalSamples)
          .where(and(eq(vitalSamples.patientId, patientId), eq(vitalSamples.metricType, 'heart_rate')))
          .orderBy(desc(vitalSamples.recordedAt))
          .limit(1);

    const [latestSpo2] = await tx
      .select({ value: vitalSamples.value })
      .from(vitalSamples)
      .where(and(eq(vitalSamples.patientId, patientId), eq(vitalSamples.metricType, 'spo2')))
      .orderBy(desc(vitalSamples.recordedAt))
      .limit(1);

    const meds = await tx
      .select({ name: medications.name, dosage: medications.dosage })
      .from(medications)
      .where(and(eq(medications.patientId, patientId), eq(medications.active, true)));

    return {
      emergencyNumber: profileRow?.emergencyNumber ?? '112',
      conditionModules: profileRow?.conditionModules ?? [],
      firstName: profileRow?.ownerName?.split(' ')[0] ?? undefined,
      latestLevel: latestRisk?.level ?? null,
      latestIndex: latestRisk?.deteriorationIndex ?? null,
      latestExplanation: latestRisk?.explanationEn ?? null,
      recentHeartRate: fallbackHr?.value ?? null,
      recentSpo2: latestSpo2?.value ?? null,
      activeMeds: meds.map((m) => `${m.name} (${m.dosage})`),
    };
  });

  const { analysis, responderSource } = await generateConversationalVoiceReply({
    transcript: parsed.data.transcript,
    locale: parsed.data.locale,
    emergencyNumber: patientCtx.emergencyNumber,
    conditions: patientCtx.conditionModules,
    context: {
      patientFirstName: patientCtx.firstName,
      latestLevel: patientCtx.latestLevel,
      latestIndex: patientCtx.latestIndex,
      latestExplanation: patientCtx.latestExplanation,
      recentHeartRate: patientCtx.recentHeartRate,
      recentSpo2: patientCtx.recentSpo2,
      activeMeds: patientCtx.activeMeds,
      history: parsed.data.history,
    },
  });

  if (!analysis.shouldLogCheckin) {
    return NextResponse.json(
      {
        checkin: null,
        conversationOnly: true,
        analysis,
        responderSource,
        triggeredAlertId: null,
      },
      { status: 201 },
    );
  }

  const result = await withSystemDb(async (tx) => {
    const [checkin] = await tx
      .insert(checkinEvents)
      .values({
        patientId,
        kind: analysis.intent === 'feeling_okay' ? 'tap_ok' : 'voice',
        locale: parsed.data.locale,
        transcript: parsed.data.transcript,
        symptoms: analysis.symptoms,
        severity: analysis.severity,
        isSynthetic: parsed.data.isSynthetic,
      })
      .returning();

    let triggeredAlertId: string | null = null;
    if (analysis.redFlag) {
      const [created] = await tx
        .insert(alerts)
        .values({
          patientId,
          alertType: 'voice_checkin_urgent',
          level: 'urgent',
          ruleKey: `voice_red_flag:${analysis.symptoms.join('+')}`,
          summaryEn: `Patient voice check-in reported severe symptoms (${analysis.symptoms.join(', ')}). Check immediately or call Emergency ${patientCtx.emergencyNumber}.`,
          summaryKn: `ಧ್ವನಿ ತಪಾಸಣೆಯಲ್ಲಿ ಗಂಭೀರ ಲಕ್ಷಣಗಳು (${analysis.symptoms.join(', ')}) ಕಂಡುಬಂದಿವೆ.`,
          summaryHi: `वॉयस जांच में गंभीर लक्षण (${analysis.symptoms.join(', ')}) बताए गए हैं।`,
          status: 'open',
          escalationStep: 1,
          nextEscalationAt: new Date(Date.now() + 5 * 60_000),
          isSynthetic: parsed.data.isSynthetic,
        })
        .returning({ id: alerts.id });
      triggeredAlertId = created?.id ?? null;
    }

    await appendAuditLog(tx, {
      actorUserId: ctx.userId,
      action: 'voice.checkin_processed',
      targetType: 'checkin_event',
      targetId: checkin?.id ?? patientId,
      payload: {
        patientId,
        channel: parsed.data.channel,
        intent: analysis.intent,
        symptoms: analysis.symptoms,
        severity: analysis.severity,
        redFlag: analysis.redFlag,
        responderSource,
        triggeredAlertId,
      },
    });

    return { checkin, triggeredAlertId };
  });

  if (result.triggeredAlertId) {
    await processOutboxBatch(patientId);
    publishPatientEvent({
      type: 'alert.created',
      patientId,
      timestamp: new Date().toISOString(),
      data: { alertId: result.triggeredAlertId, source: 'voice_red_flag' },
    });
  } else {
    publishPatientEvent({
      type: 'engine.evaluated',
      patientId,
      timestamp: new Date().toISOString(),
      data: { checkinId: result.checkin?.id, kind: 'voice' },
    });
  }

  return NextResponse.json(
    {
      checkin: result.checkin,
      conversationOnly: false,
      analysis,
      responderSource,
      triggeredAlertId: result.triggeredAlertId,
    },
    { status: 201 },
  );
}
