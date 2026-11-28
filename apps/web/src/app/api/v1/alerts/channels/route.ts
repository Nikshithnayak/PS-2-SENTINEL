import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getNotificationReadiness,
  sendTestAlertNotification,
} from '@/lib/alerts/outbox';
import { getAccessiblePatientIds } from '@/lib/dashboard/queries';
import { checkPatientScope, requireSession } from '@/lib/session';

const TestBodySchema = z.object({
  patientId: z.string().uuid().optional(),
});

async function resolveOptionalPatientId(
  ctx: Parameters<typeof getAccessiblePatientIds>[0],
  requested?: string,
): Promise<string | null> {
  if (requested) {
    const ok =
      (await checkPatientScope(ctx, requested, 'alerts_receive')) ||
      (await checkPatientScope(ctx, requested, 'vitals_read'));
    return ok ? requested : null;
  }
  const accessible = await getAccessiblePatientIds(ctx);
  return accessible[0] ?? null;
}

export async function GET(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const requested = request.nextUrl.searchParams.get('patientId') ?? undefined;
  const patientId = await resolveOptionalPatientId(ctx, requested);
  const readiness = await getNotificationReadiness({
    userId: ctx.userId,
    patientId,
  });
  return NextResponse.json(readiness);
}

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const raw = await request.json().catch(() => ({}));
  const parsed = TestBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid test notification body' }, { status: 400 });
  }

  const patientId = await resolveOptionalPatientId(ctx, parsed.data.patientId);
  const result = await sendTestAlertNotification({
    userId: ctx.userId,
    userEmail: ctx.email,
    userName: ctx.name,
    patientId,
  });
  return NextResponse.json(result);
}
