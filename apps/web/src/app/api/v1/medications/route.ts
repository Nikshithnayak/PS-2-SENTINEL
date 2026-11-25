import { NextResponse, type NextRequest } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog, withSystemDb } from '@/db';
import { medicationEvents, medications } from '@/db/schema';
import { getAccessiblePatientIds } from '@/lib/dashboard/queries';
import { lookupRxNormDrug } from '@/lib/meds/rxnorm';
import { checkPatientScope, requireSession } from '@/lib/session';

const MedPostSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add_medication'),
    patientId: z.string().uuid().optional(),
    name: z.string().min(2).max(120),
    dosage: z.string().min(1).max(60).default('25 mg'),
    scheduleTimes: z.array(z.string()).default(['08:00']),
  }),
  z.object({
    action: z.literal('log_dose'),
    patientId: z.string().uuid().optional(),
    medicationId: z.string().uuid(),
    status: z.enum(['taken', 'missed', 'late']),
  }),
]);

export async function GET(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const lookup = request.nextUrl.searchParams.get('lookup');
  if (lookup) {
    const info = await lookupRxNormDrug(lookup);
    return NextResponse.json({ lookup: info });
  }

  const accessible = await getAccessiblePatientIds(ctx);
  const patientId = request.nextUrl.searchParams.get('patientId') ?? accessible[0];
  if (!patientId) return NextResponse.json({ medications: [], events: [] });

  if (!(await checkPatientScope(ctx, patientId, 'vitals_read'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const payload = await withSystemDb(async (tx) => {
    const meds = await tx
      .select()
      .from(medications)
      .where(eq(medications.patientId, patientId))
      .orderBy(desc(medications.createdAt));

    const events = await tx
      .select()
      .from(medicationEvents)
      .where(eq(medicationEvents.patientId, patientId))
      .orderBy(desc(medicationEvents.recordedAt))
      .limit(30);

    return { patientId, medications: meds, events };
  });

  return NextResponse.json(payload);
}

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const raw = await request.json().catch(() => null);
  const parsed = MedPostSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid medication request' }, { status: 400 });
  }

  const accessible = await getAccessiblePatientIds(ctx);
  const patientId = parsed.data.patientId ?? accessible[0];
  if (!patientId) return NextResponse.json({ error: 'patientId required' }, { status: 400 });

  if (!(await checkPatientScope(ctx, patientId, 'vitals_read'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (parsed.data.action === 'add_medication') {
    const addReq = parsed.data;
    const rx = await lookupRxNormDrug(addReq.name);
    const created = await withSystemDb(async (tx) => {
      const existing = await tx
        .select()
        .from(medications)
        .where(
          and(
            eq(medications.patientId, patientId),
            eq(medications.name, rx.normalizedName),
            eq(medications.active, true),
          ),
        )
        .limit(1);

      if (existing[0]) {
        return existing[0];
      }

      const [row] = await tx
        .insert(medications)
        .values({
          patientId,
          name: rx.normalizedName,
          rxcui: rx.rxcui,
          dosage: addReq.dosage,
          scheduleTimes: addReq.scheduleTimes,
          affectsHeartRate: rx.affectsHeartRate,
          active: true,
        })
        .returning();

      await appendAuditLog(tx, {
        actorUserId: ctx.userId,
        action: 'medication.added',
        targetType: 'medication',
        targetId: row?.id ?? patientId,
        payload: { patientId, name: rx.normalizedName, rxcui: rx.rxcui },
      });
      return row;
    });

    return NextResponse.json({ medication: created, rxInfo: rx }, { status: 201 });
  }

  const logReq = parsed.data;
  const logged = await withSystemDb(async (tx) => {
    const [evt] = await tx
      .insert(medicationEvents)
      .values({
        medicationId: logReq.medicationId,
        patientId,
        status: logReq.status,
        scheduledAt: new Date(),
      })
      .returning();

    await appendAuditLog(tx, {
      actorUserId: ctx.userId,
      action: 'medication.dose_logged',
      targetType: 'medication_event',
      targetId: evt?.id ?? logReq.medicationId,
      payload: { patientId, status: logReq.status },
    });

    return evt;
  });

  return NextResponse.json({ event: logged }, { status: 201 });
}
