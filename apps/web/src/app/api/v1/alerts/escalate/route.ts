import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { withSystemDb } from '@/db';
import { patientProfiles } from '@/db/schema';
import { escalateAlerts, processOutboxBatch } from '@/lib/alerts/outbox';
import { checkPatientScope, requireSession } from '@/lib/session';

const EscalateSchema = z.object({
  patientId: z.string().uuid().optional(),
  alertId: z.string().uuid().optional(),
  forceImmediate: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const raw = await request.json().catch(() => ({}));
  const parsed = EscalateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid escalation request' }, { status: 400 });
  }

  let patientId = parsed.data.patientId;
  if (!patientId) {
    const own = await withSystemDb((tx) =>
      tx
        .select({ id: patientProfiles.id })
        .from(patientProfiles)
        .where(eq(patientProfiles.userId, ctx.userId))
        .limit(1),
    );
    patientId = own[0]?.id;
  }

  if (patientId) {
    const canAlert = await checkPatientScope(ctx, patientId, 'alerts_receive');
    const canRead = await checkPatientScope(ctx, patientId, 'vitals_read');
    if (!canAlert && !canRead) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const escalated = await escalateAlerts({
    patientId,
    alertId: parsed.data.alertId,
    forceImmediate: parsed.data.forceImmediate,
    actorUserId: ctx.userId,
  });
  const outbox = await processOutboxBatch(patientId);

  return NextResponse.json({ escalated, outbox });
}
