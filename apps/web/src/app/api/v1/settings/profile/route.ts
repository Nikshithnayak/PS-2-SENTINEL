import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog, withSystemDb } from '@/db';
import { patientProfiles, user } from '@/db/schema';
import { getAccessiblePatientIds } from '@/lib/dashboard/queries';
import { checkPatientScope, requireSession } from '@/lib/session';

const ProfileUpdateSchema = z.object({
  patientId: z.string().uuid().optional(),
  locale: z.enum(['en', 'kn', 'hi']).optional(),
  quietHoursStart: z.number().int().min(0).max(23).optional(),
  quietHoursEnd: z.number().int().min(0).max(23).optional(),
  dailyAlertBudget: z.number().int().min(1).max(20).optional(),
  silentAlertHours: z.number().int().min(4).max(72).optional(),
  sensitivityOffset: z.number().min(-0.25).max(0.25).optional(),
  emergencyNumber: z.string().min(2).max(16).optional(),
  ambulanceNumber: z.string().min(2).max(16).optional(),
  city: z.string().min(2).max(80).optional(),
  conditionModules: z
    .array(z.enum(['general_frailty', 'heart_failure', 'copd', 'hypertension', 'diabetes']))
    .min(1)
    .optional(),
});

export async function GET(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const accessible = await getAccessiblePatientIds(ctx);
  const patientId = request.nextUrl.searchParams.get('patientId') ?? accessible[0];
  if (!patientId) return NextResponse.json({ error: 'patientId required' }, { status: 400 });

  const canRead = await checkPatientScope(ctx, patientId, 'vitals_read');
  if (!canRead) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [profile] = await withSystemDb((tx) =>
    tx.select().from(patientProfiles).where(eq(patientProfiles.id, patientId)).limit(1),
  );
  return NextResponse.json({ profile: profile ?? null });
}

export async function PATCH(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const body = await request.json().catch(() => null);
  const parsed = ProfileUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid profile settings payload' }, { status: 400 });
  }

  const accessible = await getAccessiblePatientIds(ctx);
  const patientId = parsed.data.patientId ?? accessible[0];
  if (!patientId) return NextResponse.json({ error: 'patientId required' }, { status: 400 });

  const canEdit = await checkPatientScope(ctx, patientId, 'vitals_read');
  if (!canEdit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const updated = await withSystemDb(async (tx) => {
    const updates: Partial<typeof patientProfiles.$inferInsert> = {};
    if (parsed.data.locale !== undefined) updates.locale = parsed.data.locale;
    if (parsed.data.quietHoursStart !== undefined) updates.quietHoursStart = parsed.data.quietHoursStart;
    if (parsed.data.quietHoursEnd !== undefined) updates.quietHoursEnd = parsed.data.quietHoursEnd;
    if (parsed.data.dailyAlertBudget !== undefined) updates.dailyAlertBudget = parsed.data.dailyAlertBudget;
    if (parsed.data.silentAlertHours !== undefined) updates.silentAlertHours = parsed.data.silentAlertHours;
    if (parsed.data.sensitivityOffset !== undefined) {
      updates.sensitivityOffset = Number(parsed.data.sensitivityOffset.toFixed(3));
    }
    if (parsed.data.emergencyNumber !== undefined) updates.emergencyNumber = parsed.data.emergencyNumber;
    if (parsed.data.ambulanceNumber !== undefined) updates.ambulanceNumber = parsed.data.ambulanceNumber;
    if (parsed.data.city !== undefined) updates.city = parsed.data.city;
    if (parsed.data.conditionModules !== undefined) updates.conditionModules = parsed.data.conditionModules;

    const [row] = await tx
      .update(patientProfiles)
      .set(updates)
      .where(eq(patientProfiles.id, patientId))
      .returning();

    if (parsed.data.locale !== undefined && row) {
      await tx.update(user).set({ locale: parsed.data.locale }).where(eq(user.id, row.userId));
    }

    await appendAuditLog(tx, {
      actorUserId: ctx.userId,
      action: 'settings.profile_updated',
      targetType: 'patient_profile',
      targetId: patientId,
      payload: { fields: Object.keys(updates) },
    });

    return row;
  });

  return NextResponse.json({ profile: updated });
}
