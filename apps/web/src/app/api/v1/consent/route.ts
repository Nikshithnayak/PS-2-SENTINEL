import { NextResponse, type NextRequest } from 'next/server';
import { ConsentGrantMutationSchema } from '@sentinel/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { appendAuditLog, withSystemDb } from '@/db';
import { consentGrants, patientProfiles, user } from '@/db/schema';
import { checkPatientScope, requireSession } from '@/lib/session';

export async function GET(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const requestedPatientId = request.nextUrl.searchParams.get('patientId');

  const data = await withSystemDb(async (tx) => {
    let patientId = requestedPatientId;
    if (!patientId) {
      const own = await tx
        .select({ id: patientProfiles.id })
        .from(patientProfiles)
        .where(eq(patientProfiles.userId, ctx.userId))
        .limit(1);
      patientId = own[0]?.id ?? null;
    }

    if (!patientId) {
      // Caregiver/Clinician listing patients they have active consent for
      const granted = await tx
        .select({
          id: consentGrants.id,
          patientId: consentGrants.patientId,
          granteeUserId: consentGrants.granteeUserId,
          relationship: consentGrants.relationship,
          scopes: consentGrants.scopes,
          grantedAt: consentGrants.grantedAt,
          withdrawnAt: consentGrants.withdrawnAt,
          reason: consentGrants.reason,
          displayCode: patientProfiles.displayCode,
        })
        .from(consentGrants)
        .innerJoin(patientProfiles, eq(consentGrants.patientId, patientProfiles.id))
        .where(eq(consentGrants.granteeUserId, ctx.userId))
        .orderBy(desc(consentGrants.grantedAt));
      return { patientId: null, grants: granted };
    }

    const allowed = await checkPatientScope(ctx, patientId, 'vitals_read');
    if (!allowed) {
      return null;
    }

    const rows = await tx
      .select({
        id: consentGrants.id,
        patientId: consentGrants.patientId,
        granteeUserId: consentGrants.granteeUserId,
        granteeName: user.name,
        granteeEmail: user.email,
        relationship: consentGrants.relationship,
        scopes: consentGrants.scopes,
        grantedAt: consentGrants.grantedAt,
        withdrawnAt: consentGrants.withdrawnAt,
        reason: consentGrants.reason,
      })
      .from(consentGrants)
      .innerJoin(user, eq(consentGrants.granteeUserId, user.id))
      .where(eq(consentGrants.patientId, patientId))
      .orderBy(desc(consentGrants.grantedAt));

    const seen = new Set<string>();
    const currentGrants = rows.filter((r) => {
      if (seen.has(r.granteeUserId)) return false;
      seen.add(r.granteeUserId);
      return true;
    });

    return { patientId, grants: currentGrants, totalEvents: rows.length };
  });

  if (data === null) {
    return NextResponse.json({ error: 'Forbidden: no active consent for patient' }, { status: 403 });
  }
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const rawBody = await request.json().catch(() => null);
  const parsed = ConsentGrantMutationSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid consent payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const input = parsed.data;

  const result = await withSystemDb(async (tx) => {
    const profile = await tx
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.userId, ctx.userId))
      .limit(1);

    const patient = profile[0];
    if (!patient) {
      return { error: 'Only a patient can manage their own consent ledger', status: 403 as const };
    }

    if (input.action === 'withdraw') {
      const updated = await tx
        .update(consentGrants)
        .set({
          withdrawnAt: new Date(),
          reason: input.reason ?? 'Withdrawn by data principal (DPDP Act)',
        })
        .where(
          and(
            eq(consentGrants.patientId, patient.id),
            eq(consentGrants.granteeUserId, input.granteeUserId),
            isNull(consentGrants.withdrawnAt),
          ),
        )
        .returning({ id: consentGrants.id });

      const audit = await appendAuditLog(tx, {
        actorUserId: ctx.userId,
        action: 'consent.withdraw',
        targetType: 'consent_grant',
        targetId: updated[0]?.id ?? input.granteeUserId,
        payload: {
          patientId: patient.id,
          granteeUserId: input.granteeUserId,
          withdrawnCount: updated.length,
          reason: input.reason ?? null,
        },
      });

      return { status: 200 as const, action: 'withdraw', updatedCount: updated.length, audit };
    }

    // Withdraw any stale active grant for the same grantee before issuing fresh scopes
    await tx
      .update(consentGrants)
      .set({ withdrawnAt: new Date(), reason: 'Superseded by updated consent grant' })
      .where(
        and(
          eq(consentGrants.patientId, patient.id),
          eq(consentGrants.granteeUserId, input.granteeUserId),
          isNull(consentGrants.withdrawnAt),
        ),
      );

    const inserted = await tx
      .insert(consentGrants)
      .values({
        patientId: patient.id,
        granteeUserId: input.granteeUserId,
        relationship: input.relationship,
        scopes: input.scopes,
        reason: input.reason ?? 'Explicit consent granted',
      })
      .returning();

    const grant = inserted[0]!;
    const audit = await appendAuditLog(tx, {
      actorUserId: ctx.userId,
      action: 'consent.grant',
      targetType: 'consent_grant',
      targetId: grant.id,
      payload: {
        patientId: patient.id,
        granteeUserId: input.granteeUserId,
        scopes: input.scopes,
      },
    });

    return { status: 201 as const, action: 'grant', grant, audit };
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result, { status: result.status });
}
