import { NextResponse, type NextRequest } from 'next/server';
import { getAccessiblePatientIds, loadVitalsSeries } from '@/lib/dashboard/queries';
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
  if (!(await checkPatientScope(ctx, patientId, 'vitals_read'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const metricType = request.nextUrl.searchParams.get('metric') ?? 'resting_heart_rate';
  const rawWindow = request.nextUrl.searchParams.get('window');
  const window = rawWindow === '24h' || rawWindow === '30d' ? rawWindow : '7d';

  const series = await loadVitalsSeries({
    patientId,
    metricType,
    window,
  });

  return NextResponse.json(series);
}
