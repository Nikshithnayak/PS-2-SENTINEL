import { NextResponse, type NextRequest } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { appendAuditLog, withSystemDb } from '@/db';
import { alerts, patientProfiles, vitalRollupsHourly } from '@/db/schema';
import { getAccessiblePatientIds } from '@/lib/dashboard/queries';
import { buildFhirR4Bundle } from '@/lib/exports/fhir';
import { checkPatientScope, requireSession } from '@/lib/session';

export async function GET(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const accessible = await getAccessiblePatientIds(ctx);
  const patientId = request.nextUrl.searchParams.get('patientId') ?? accessible[0];
  if (!patientId) {
    return NextResponse.json({ error: 'patientId required' }, { status: 400 });
  }

  const canExport =
    (await checkPatientScope(ctx, patientId, 'clinician_export')) ||
    (await checkPatientScope(ctx, patientId, 'vitals_read'));
  if (!canExport) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const data = await withSystemDb(async (tx) => {
    const [profile] = await tx
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.id, patientId))
      .limit(1);
    if (!profile) return null;

    const rollups = await tx
      .select()
      .from(vitalRollupsHourly)
      .where(eq(vitalRollupsHourly.patientId, patientId))
      .orderBy(desc(vitalRollupsHourly.bucketStart))
      .limit(60);

    const alertList = await tx
      .select()
      .from(alerts)
      .where(eq(alerts.patientId, patientId))
      .orderBy(desc(alerts.createdAt))
      .limit(20);

    await appendAuditLog(tx, {
      actorUserId: ctx.userId,
      action: 'export.fhir_r4_bundle',
      targetType: 'patient_profile',
      targetId: patientId,
      payload: { observations: rollups.length, flags: alertList.length },
    });

    return { profile, rollups, alertList };
  });

  if (!data) {
    return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
  }

  const bundle = buildFhirR4Bundle({
    patientId: data.profile.id,
    displayCode: data.profile.displayCode,
    sex: data.profile.sex,
    city: data.profile.city,
    isSynthetic: data.profile.isSynthetic || data.rollups.some((r) => r.isSynthetic),
    rollups: data.rollups.map((r, idx) => ({
      id: `obs-${r.metricType}-${r.bucketStart.getTime()}-${idx}`,
      metricType: r.metricType,
      medianVal: r.medianVal,
      bucketStart: r.bucketStart,
      isSynthetic: r.isSynthetic,
    })),
    alerts: data.alertList,
  });

  return NextResponse.json(bundle, {
    headers: {
      'content-type': 'application/fhir+json; charset=utf-8',
      'content-disposition': `attachment; filename="sentinel-fhir-${data.profile.displayCode}.json"`,
    },
  });
}
