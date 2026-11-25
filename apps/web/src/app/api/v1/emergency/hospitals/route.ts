import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { withSystemDb } from '@/db';
import { patientProfiles } from '@/db/schema';
import { findNearbyHospitals } from '@/lib/alerts/emergency';
import { checkPatientScope, requireSession } from '@/lib/session';

export async function GET(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  let patientId = request.nextUrl.searchParams.get('patientId') ?? undefined;
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

  if (!patientId) {
    return NextResponse.json({ error: 'patientId required' }, { status: 400 });
  }

  const canAlert = await checkPatientScope(ctx, patientId, 'alerts_receive');
  const canRead = await checkPatientScope(ctx, patientId, 'vitals_read');
  if (!canAlert && !canRead) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [profile] = await withSystemDb((tx) =>
    tx
      .select({
        city: patientProfiles.city,
        regionLat: patientProfiles.regionLat,
        regionLon: patientProfiles.regionLon,
        emergencyNumber: patientProfiles.emergencyNumber,
        ambulanceNumber: patientProfiles.ambulanceNumber,
      })
      .from(patientProfiles)
      .where(eq(patientProfiles.id, patientId))
      .limit(1),
  );

  const hospitals = await findNearbyHospitals(
    profile?.regionLat ?? 12.91,
    profile?.regionLon ?? 74.86,
    profile?.city ?? 'Mangaluru',
  );

  return NextResponse.json({
    emergencyNumber: profile?.emergencyNumber ?? '112',
    ambulanceNumber: profile?.ambulanceNumber ?? '108',
    city: profile?.city ?? 'Mangaluru',
    hospitals,
  });
}
