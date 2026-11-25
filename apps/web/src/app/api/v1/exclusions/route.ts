import { NextResponse, type NextRequest } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog, withSystemDb } from '@/db';
import { excludedPeriods, patientProfiles } from '@/db/schema';
import { checkPatientScope, requireSession } from '@/lib/session';

const ExclusionCreateSchema = z.object({
  patientId: z.string().uuid().optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  reason: z.enum(['illness', 'hospital', 'travel', 'device_swap', 'medication_change', 'other']),
  note: z.string().max(400).optional(),
});

async function resolvePatient(userId: string, requested?: string): Promise<string | null> {
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

  const patientId = await resolvePatient(
    ctx.userId,
    request.nextUrl.searchParams.get('patientId') ?? undefined,
  );
  if (!patientId) return NextResponse.json({ error: 'patientId required' }, { status: 400 });
  if (!(await checkPatientScope(ctx, patientId, 'vitals_read'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const periods = await withSystemDb((tx) =>
    tx
      .select()
      .from(excludedPeriods)
      .where(eq(excludedPeriods.patientId, patientId))
      .orderBy(desc(excludedPeriods.startAt)),
  );
  return NextResponse.json({ excludedPeriods: periods });
}

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const body = await request.json().catch(() => null);
  const parsed = ExclusionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid exclusion payload' }, { status: 400 });
  }

  const startDate = new Date(parsed.data.startAt);
  const endDate = new Date(parsed.data.endAt);
  if (endDate <= startDate) {
    return NextResponse.json({ error: 'endAt must be after startAt' }, { status: 400 });
  }

  const patientId = await resolvePatient(ctx.userId, parsed.data.patientId);
  if (!patientId) return NextResponse.json({ error: 'patientId required' }, { status: 400 });
  if (!(await checkPatientScope(ctx, patientId, 'vitals_read'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const created = await withSystemDb(async (tx) => {
    const [row] = await tx
      .insert(excludedPeriods)
      .values({
        patientId,
        startAt: startDate,
        endAt: endDate,
        reason: parsed.data.reason,
        note: parsed.data.note ?? null,
        createdByUserId: ctx.userId,
      })
      .returning();

    await appendAuditLog(tx, {
      actorUserId: ctx.userId,
      action: 'baseline.exclusion_added',
      targetType: 'excluded_period',
      targetId: row?.id ?? patientId,
      payload: { patientId, reason: parsed.data.reason },
    });
    return row;
  });

  return NextResponse.json({ excludedPeriod: created }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const id = request.nextUrl.searchParams.get('id');
  const patientId = await resolvePatient(
    ctx.userId,
    request.nextUrl.searchParams.get('patientId') ?? undefined,
  );
  if (!id || !patientId) {
    return NextResponse.json({ error: 'id and patientId required' }, { status: 400 });
  }
  if (!(await checkPatientScope(ctx, patientId, 'vitals_read'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await withSystemDb(async (tx) => {
    await tx
      .delete(excludedPeriods)
      .where(and(eq(excludedPeriods.id, id), eq(excludedPeriods.patientId, patientId)));
    await appendAuditLog(tx, {
      actorUserId: ctx.userId,
      action: 'baseline.exclusion_removed',
      targetType: 'excluded_period',
      targetId: id,
      payload: { patientId },
    });
  });

  return NextResponse.json({ deleted: true });
}
