import { NextResponse, type NextRequest } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog, withSystemDb } from '@/db';
import { checkinEvents, patientProfiles } from '@/db/schema';
import { publishPatientEvent } from '@/lib/alerts/events';
import { triggerDirectCheckinAlert } from '@/lib/alerts/outbox';
import { getAccessiblePatientIds } from '@/lib/dashboard/queries';
import { checkPatientScope, requireSession } from '@/lib/session';

const CheckinSchema = z.object({
  patientId: z.string().uuid().optional(),
  kind: z.enum(['tap_ok', 'tap_unwell', 'voice', 'symptom_log']).default('tap_ok'),
  locale: z.enum(['en', 'kn', 'hi']).default('en'),
  transcript: z.string().max(1000).optional(),
  symptoms: z.array(z.string().max(60)).default([]),
  severity: z.enum(['none', 'mild', 'moderate', 'severe']).default('none'),
  isSynthetic: z.boolean().default(false),
});

export async function GET(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const accessible = await getAccessiblePatientIds(ctx);
  const patientId = request.nextUrl.searchParams.get('patientId') ?? accessible[0];
  if (!patientId) return NextResponse.json({ checkins: [] });

  const canView =
    (await checkPatientScope(ctx, patientId, 'checkin_view')) ||
    (await checkPatientScope(ctx, patientId, 'vitals_read'));
  if (!canView) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const checkins = await withSystemDb((tx) =>
    tx
      .select()
      .from(checkinEvents)
      .where(eq(checkinEvents.patientId, patientId))
      .orderBy(desc(checkinEvents.recordedAt))
      .limit(20),
  );
  return NextResponse.json({ checkins });
}

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const raw = await request.json().catch(() => null);
  const parsed = CheckinSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid check-in payload' }, { status: 400 });
  }

  let patientId = parsed.data.patientId;
  if (!patientId) {
    const [own] = await withSystemDb((tx) =>
      tx
        .select({ id: patientProfiles.id })
        .from(patientProfiles)
        .where(eq(patientProfiles.userId, ctx.userId))
        .limit(1),
    );
    patientId = own?.id ?? (await getAccessiblePatientIds(ctx))[0];
  }
  if (!patientId) return NextResponse.json({ error: 'patientId required' }, { status: 400 });

  const canCheckin =
    (await checkPatientScope(ctx, patientId, 'checkin_view')) ||
    (await checkPatientScope(ctx, patientId, 'vitals_read'));
  if (!canCheckin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const created = await withSystemDb(async (tx) => {
    const [row] = await tx
      .insert(checkinEvents)
      .values({
        patientId,
        kind: parsed.data.kind,
        locale: parsed.data.locale,
        transcript: parsed.data.transcript ?? null,
        symptoms: parsed.data.symptoms,
        severity: parsed.data.severity,
        isSynthetic: parsed.data.isSynthetic,
      })
      .returning();

    await appendAuditLog(tx, {
      actorUserId: ctx.userId,
      action: 'checkin.recorded',
      targetType: 'checkin_event',
      targetId: row?.id ?? patientId,
      payload: {
        patientId,
        kind: parsed.data.kind,
        severity: parsed.data.severity,
        symptoms: parsed.data.symptoms,
      },
    });
    return row;
  });

  let triggeredAlertId: string | null = null;
  if (parsed.data.kind === 'tap_unwell') {
    const symptomLabel =
      parsed.data.symptoms.length > 0
        ? parsed.data.symptoms.join(', ')
        : 'asked for caregiver support';
    const level = parsed.data.severity === 'severe' ? 'urgent' : 'warning';
    const alertRes = await triggerDirectCheckinAlert({
      patientId,
      actorUserId: ctx.userId,
      alertType: 'checkin_unwell',
      level,
      ruleKey: `checkin:tap_unwell:${parsed.data.symptoms.join('+') || 'support'}`,
      summaryEn: `Patient tapped "I Don't Feel Well" (${symptomLabel}). Please check in with your loved one now.`,
      summaryKn: `ರೋಗಿಯು "ನನಗೆ ಸರಿಯಿಲ್ಲ" ಎಂದು ತಿಳಿಸಿದ್ದಾರೆ (${symptomLabel}). ದಯವಿಟ್ಟು ತಕ್ಷಣ ವಿಚಾರಿಸಿ.`,
      summaryHi: `मरीज़ ने "मेरी तबीयत ठीक नहीं है" दबाया है (${symptomLabel}). कृपया तुरंत संपर्क करें।`,
      isSynthetic: parsed.data.isSynthetic,
    });
    triggeredAlertId = alertRes.alertId;
  } else {
    publishPatientEvent({
      type: 'engine.evaluated',
      patientId,
      timestamp: new Date().toISOString(),
      data: { checkinId: created?.id, kind: parsed.data.kind, severity: parsed.data.severity },
    });
  }

  return NextResponse.json({ checkin: created, triggeredAlertId }, { status: 201 });
}
