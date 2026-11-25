import { NextResponse, type NextRequest } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { withSystemDb } from '@/db';
import { baselineStates, patientProfiles, riskAssessments } from '@/db/schema';
import { runAndPersistEvaluation } from '@/lib/engine/client';
import { checkPatientScope, requireSession } from '@/lib/session';

const EvaluateBodySchema = z.object({
  patientId: z.string().uuid().optional(),
});

async function resolveTargetPatientId(userId: string, requested?: string): Promise<string | null> {
  if (requested) return requested;
  const own = await withSystemDb((tx) =>
    tx
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.userId, userId))
      .limit(1),
  );
  return own[0]?.id ?? null;
}

export async function GET(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const patientId = await resolveTargetPatientId(
    ctx.userId,
    request.nextUrl.searchParams.get('patientId') ?? undefined,
  );
  if (!patientId) {
    return NextResponse.json({ error: 'Target patientId required' }, { status: 400 });
  }
  const allowed = await checkPatientScope(ctx, patientId, 'vitals_read');
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const data = await withSystemDb(async (tx) => {
    const latest = await tx
      .select()
      .from(riskAssessments)
      .where(eq(riskAssessments.patientId, patientId))
      .orderBy(desc(riskAssessments.assessedAt))
      .limit(1);
    const baselines = await tx
      .select()
      .from(baselineStates)
      .where(eq(baselineStates.patientId, patientId));
    return { latest: latest[0] ?? null, baselines };
  });

  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const rawBody = await request.json().catch(() => ({}));
  const parsed = EvaluateBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  const patientId = await resolveTargetPatientId(ctx.userId, parsed.data.patientId);
  if (!patientId) {
    return NextResponse.json({ error: 'Target patientId required' }, { status: 400 });
  }

  const allowed = await checkPatientScope(ctx, patientId, 'vitals_read');
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const evaluation = await runAndPersistEvaluation({
    patientId,
    actorUserId: ctx.userId,
  });

  return NextResponse.json(evaluation, { status: 201 });
}
