import { NextResponse, type NextRequest } from 'next/server';
import { getAccessiblePatientIds, loadPatientDashboard } from '@/lib/dashboard/queries';
import { checkPatientScope, requireSession } from '@/lib/session';

export async function GET(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const requestedId = request.nextUrl.searchParams.get('patientId');
  const accessible = await getAccessiblePatientIds(ctx);
  const targetPatientId = requestedId ?? accessible[0];

  if (!targetPatientId) {
    return NextResponse.json({ error: 'No accessible patient profile found' }, { status: 404 });
  }

  const canRead = await checkPatientScope(ctx, targetPatientId, 'vitals_read');
  const canAlerts = await checkPatientScope(ctx, targetPatientId, 'alerts_receive');
  if (!canRead && !canAlerts) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const dashboard = await loadPatientDashboard(targetPatientId);
  if (!dashboard) {
    return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
  }

  return NextResponse.json(dashboard);
}
