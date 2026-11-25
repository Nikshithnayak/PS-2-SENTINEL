import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { appendAuditLog, withSystemDb } from '@/db';
import {
  alerts,
  baselineStates,
  checkinEvents,
  consentGrants,
  medications,
  patientProfiles,
  riskAssessments,
  vitalRollupsHourly,
} from '@/db/schema';
import { getAccessiblePatientIds } from '@/lib/dashboard/queries';
import { checkPatientScope, requireSession } from '@/lib/session';

export async function GET(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const accessible = await getAccessiblePatientIds(ctx);
  const patientId = request.nextUrl.searchParams.get('patientId') ?? accessible[0];
  if (!patientId) return NextResponse.json({ error: 'patientId required' }, { status: 400 });

  if (!(await checkPatientScope(ctx, patientId, 'vitals_read'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const bundle = await withSystemDb(async (tx) => {
    const [profile] = await tx
      .select({
        id: patientProfiles.id,
        displayCode: patientProfiles.displayCode,
        ageBand: patientProfiles.ageBand,
        sex: patientProfiles.sex,
        conditionModules: patientProfiles.conditionModules,
        locale: patientProfiles.locale,
        city: patientProfiles.city,
        createdAt: patientProfiles.createdAt,
      })
      .from(patientProfiles)
      .where(eq(patientProfiles.id, patientId))
      .limit(1);

    const grants = await tx
      .select()
      .from(consentGrants)
      .where(eq(consentGrants.patientId, patientId));
    const baselines = await tx
      .select()
      .from(baselineStates)
      .where(eq(baselineStates.patientId, patientId));
    const assessments = await tx
      .select()
      .from(riskAssessments)
      .where(eq(riskAssessments.patientId, patientId));
    const alertList = await tx
      .select()
      .from(alerts)
      .where(eq(alerts.patientId, patientId));
    const checkins = await tx
      .select()
      .from(checkinEvents)
      .where(eq(checkinEvents.patientId, patientId));
    const meds = await tx
      .select()
      .from(medications)
      .where(eq(medications.patientId, patientId));
    const hourlyRollups = await tx
      .select()
      .from(vitalRollupsHourly)
      .where(eq(vitalRollupsHourly.patientId, patientId));

    await appendAuditLog(tx, {
      actorUserId: ctx.userId,
      action: 'dpdp.data_exported',
      targetType: 'patient_profile',
      targetId: patientId,
      payload: { rollupCount: hourlyRollups.length, assessmentCount: assessments.length },
    });

    return {
      exportedAt: new Date().toISOString(),
      regulation: 'India DPDP Act 2023 Data Principal Export',
      profile,
      consentGrants: grants,
      baselines,
      riskAssessments: assessments,
      alerts: alertList,
      checkins,
      medications: meds,
      hourlyRollupsCount: hourlyRollups.length,
    };
  });

  return NextResponse.json(bundle, {
    headers: {
      'content-disposition': `attachment; filename="sentinel-dpdp-export-${patientId.slice(0, 8)}.json"`,
    },
  });
}
