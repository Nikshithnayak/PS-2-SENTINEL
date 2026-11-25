import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { withSystemDb } from '@/db';
import { alerts } from '@/db/schema';
import { applyAlertAction } from '@/lib/alerts/outbox';
import { checkPatientScope, requireSession } from '@/lib/session';

const AckBodySchema = z.object({
  action: z.enum(['acknowledge', 'snooze', 'escalate', 'resolve']).default('acknowledge'),
  note: z.string().max(500).optional(),
  feedback: z
    .enum(['helpful', 'false_alarm', 'expected_activity', 'missed_symptom'])
    .optional(),
  snoozeMinutes: z.number().int().min(15).max(720).optional(),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;
  const { id } = await context.params;

  const [alertRow] = await withSystemDb((tx) =>
    tx.select({ patientId: alerts.patientId }).from(alerts).where(eq(alerts.id, id)).limit(1),
  );
  if (!alertRow) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
  }

  const canReceive = await checkPatientScope(ctx, alertRow.patientId, 'alerts_receive');
  const canRead = await checkPatientScope(ctx, alertRow.patientId, 'vitals_read');
  if (!canReceive && !canRead) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rawBody = await request.json().catch(() => ({}));
  const parsed = AckBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid acknowledgement body' }, { status: 400 });
  }

  const result = await applyAlertAction({
    alertId: id,
    actorUserId: ctx.userId,
    action: parsed.data.action,
    note: parsed.data.note,
    feedback: parsed.data.feedback,
    snoozeMinutes: parsed.data.snoozeMinutes,
  });

  return NextResponse.json(result);
}
