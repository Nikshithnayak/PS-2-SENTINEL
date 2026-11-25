import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { withSystemDb } from '@/db';
import { patientProfiles } from '@/db/schema';
import { refreshPatientEnvironment } from '@/lib/context/open-meteo';
import { checkPatientScope, requireSession } from '@/lib/session';

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const body = (await request.json().catch(() => ({}))) as { patientId?: string };
  let patientId = body.patientId;
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
    return NextResponse.json({ error: 'Target patientId required' }, { status: 400 });
  }
  const allowed = await checkPatientScope(ctx, patientId, 'vitals_read');
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const env = await refreshPatientEnvironment(patientId);
    return NextResponse.json(env);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Environment lookup failed' },
      { status: 502 },
    );
  }
}
