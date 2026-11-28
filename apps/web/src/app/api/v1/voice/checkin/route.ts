import { NextResponse, type NextRequest } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog, withSystemDb } from '@/db';
import {
  checkinEvents,
  medications,
  patientProfiles,
  riskAssessments,
  user,
  vitalSamples,
} from '@/db/schema';
import { publishPatientEvent } from '@/lib/alerts/events';
import { triggerDirectCheckinAlert } from '@/lib/alerts/outbox';
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

  const shouldTriggerAlert =
    analysis.redFlag || analysis.symptoms.includes('caregiver_callback_requested');

  const checkin = await withSystemDb(async (tx) => {
    const [row] = await tx
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

    await appendAuditLog(tx, {
      actorUserId: ctx.userId,
      action: 'voice.checkin_processed',
      targetType: 'checkin_event',
      targetId: row?.id ?? patientId,
      payload: {
        patientId,
        channel: parsed.data.channel,
        intent: analysis.intent,
        symptoms: analysis.symptoms,
        severity: analysis.severity,
        redFlag: analysis.redFlag,
        responderSource,
      },
    });

    return row;
  });

  let triggeredAlertId: string | null = null;
  if (shouldTriggerAlert) {
    const level = analysis.redFlag ? 'urgent' : 'warning';
    const symptomLabel = analysis.symptoms.length ? analysis.symptoms.join(', ') : 'voice check-in';
    const directRes = await triggerDirectCheckinAlert({
      patientId,
      actorUserId: ctx.userId,
      alertType: 'voice_checkin_urgent',
      level,
      ruleKey: `voice_red_flag:${analysis.symptoms.join('+') || 'callback'}`,
      summaryEn: analysis.redFlag
        ? `Patient voice check-in reported severe symptoms (${symptomLabel}). Check immediately or call Emergency ${patientCtx.emergencyNumber}.`
        : `Patient asked voice assistant to contact caregiver (${symptomLabel}). Please reach out and check in.`,
      summaryKn: `ಧ್ವನಿ ತಪಾಸಣೆಯಲ್ಲಿ ಲಕ್ಷಣಗಳು (${symptomLabel}) ಕಂಡುಬಂದಿವೆ. ದಯವಿಟ್ಟು ತಕ್ಷಣ ವಿಚಾರಿಸಿ.`,
      summaryHi: `वॉयस जांच में लक्षण (${symptomLabel}) बताए गए हैं। कृपया तुरंत संपर्क करें।`,
      isSynthetic: parsed.data.isSynthetic,
    });
    triggeredAlertId = directRes.alertId;
  } else {
    publishPatientEvent({
      type: 'engine.evaluated',
      patientId,
      timestamp: new Date().toISOString(),
      data: { checkinId: checkin?.id, kind: 'voice' },
    });
  }

  return NextResponse.json(
    {
      checkin,
      conversationOnly: false,
      analysis,
      responderSource,
      triggeredAlertId,
    },
    { status: 201 },
  );
}
