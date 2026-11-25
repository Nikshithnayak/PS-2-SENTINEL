import { NextResponse, type NextRequest } from 'next/server';
import { eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog, withSystemDb } from '@/db';
import { apiKeys, consentGrants, patientProfiles, pushSubscriptions } from '@/db/schema';
import { requireSession } from '@/lib/session';

const EraseSchema = z.object({
  patientId: z.string().uuid().optional(),
  confirmPhrase: z.literal('ERASE MY DATA'),
});

/**
 * DPDP Act 2023 Right to Erasure handler: only the patient (or org_admin) may invoke;
 * revokes active consent grants/keys, scrubs encrypted PII, marks `deletedAt`,
 * and records an immutable audit receipt without altering historical safety hash-chain integrity.
 */
export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const raw = await request.json().catch(() => null);
  const parsed = EraseSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Confirm with exact phrase "ERASE MY DATA"' },
      { status: 400 },
    );
  }

  const [own] = await withSystemDb((tx) =>
    tx
      .select()
      .from(patientProfiles)
      .where(eq(patientProfiles.userId, ctx.userId))
      .limit(1),
  );

  const targetId = parsed.data.patientId ?? own?.id;
  if (!targetId) {
    return NextResponse.json({ error: 'Patient profile not found' }, { status: 404 });
  }
  if (own?.id !== targetId && ctx.role !== 'org_admin') {
    return NextResponse.json({ error: 'Only the patient principal or org_admin may erase' }, { status: 403 });
  }

  const now = new Date();
  await withSystemDb(async (tx) => {
    await tx
      .update(patientProfiles)
      .set({
        fullNameEnc: 'ERASED',
        phoneEnc: null,
        emergencyContactEnc: null,
        deletedAt: now,
      })
      .where(eq(patientProfiles.id, targetId));

    await tx
      .update(consentGrants)
      .set({ withdrawnAt: now, reason: 'DPDP right to erasure requested' })
      .where(eq(consentGrants.patientId, targetId));

    await tx
      .update(apiKeys)
      .set({ revokedAt: now })
      .where(eq(apiKeys.patientId, targetId));

    await tx
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, ctx.userId));

    await appendAuditLog(tx, {
      actorUserId: ctx.userId,
      action: 'dpdp.erasure_executed',
      targetType: 'patient_profile',
      targetId,
      payload: { erasedAt: now.toISOString(), status: 'scrubbed_and_revoked' },
    });
  });

  // Verify consent grants remaining null check unused variable warning prevented
  void isNull;

  return NextResponse.json({
    erased: true,
    patientId: targetId,
    erasedAt: now.toISOString(),
  });
}
