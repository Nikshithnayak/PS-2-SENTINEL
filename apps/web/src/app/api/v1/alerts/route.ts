import { NextResponse, type NextRequest } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { withSystemDb } from '@/db';
import { alertDeliveries, alerts, patientProfiles } from '@/db/schema';
import { checkPatientScope, requireSession } from '@/lib/session';

async function resolvePatientId(userId: string, requested?: string): Promise<string | null> {
  if (requested) return requested;
  const rows = await withSystemDb((tx) =>
    tx
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.userId, userId))
      .limit(1),
  );
  return rows[0]?.id ?? null;
}

export async function GET(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const patientId = await resolvePatientId(
    ctx.userId,
    request.nextUrl.searchParams.get('patientId') ?? undefined,
  );
  if (!patientId) {
    return NextResponse.json({ error: 'patientId required' }, { status: 400 });
  }
  const hasVitalsScope = await checkPatientScope(ctx, patientId, 'vitals_read');
  const hasAlertScope = await checkPatientScope(ctx, patientId, 'alerts_receive');
  if (!hasVitalsScope && !hasAlertScope) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const payload = await withSystemDb(async (tx) => {
    const [profile] = await tx
      .select({
        emergencyNumber: patientProfiles.emergencyNumber,
        ambulanceNumber: patientProfiles.ambulanceNumber,
        quietHoursStart: patientProfiles.quietHoursStart,
        quietHoursEnd: patientProfiles.quietHoursEnd,
        dailyAlertBudget: patientProfiles.dailyAlertBudget,
        sensitivityOffset: patientProfiles.sensitivityOffset,
        city: patientProfiles.city,
        regionLat: patientProfiles.regionLat,
        regionLon: patientProfiles.regionLon,
      })
      .from(patientProfiles)
      .where(eq(patientProfiles.id, patientId))
      .limit(1);

    const alertRows = await tx
      .select()
      .from(alerts)
      .where(eq(alerts.patientId, patientId))
      .orderBy(desc(alerts.createdAt))
      .limit(25);

    const deliveries = await tx
      .select()
      .from(alertDeliveries)
      .where(eq(alertDeliveries.patientId, patientId))
      .orderBy(desc(alertDeliveries.createdAt))
      .limit(40);

    return {
      patientId,
      settings: profile ?? null,
      alerts: alertRows,
      deliveries,
    };
  });

  return NextResponse.json(payload);
}
