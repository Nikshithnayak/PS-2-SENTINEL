import { NextResponse, type NextRequest } from 'next/server';
import { hashApiKey } from '@sentinel/shared';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog, withSystemDb } from '@/db';
import { careCircleMembers, consentGrants, patientProfiles, user } from '@/db/schema';
import { requireSession } from '@/lib/session';

const InviteSchema = z.object({
  email: z.string().email(),
  relationship: z.enum(['primary_caregiver', 'secondary_caregiver', 'clinician', 'researcher']),
  priorityOrder: z.number().int().min(1).max(10).default(2),
});

export async function GET() {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const members = await withSystemDb(async (tx) => {
    const profile = await tx
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.userId, ctx.userId))
      .limit(1);

    if (profile[0]) {
      return tx
        .select({
          id: careCircleMembers.id,
          patientId: careCircleMembers.patientId,
          memberUserId: careCircleMembers.memberUserId,
          invitedEmail: careCircleMembers.invitedEmail,
          relationship: careCircleMembers.relationship,
          priorityOrder: careCircleMembers.priorityOrder,
          status: careCircleMembers.status,
          memberName: user.name,
        })
        .from(careCircleMembers)
        .leftJoin(user, eq(careCircleMembers.memberUserId, user.id))
        .where(eq(careCircleMembers.patientId, profile[0].id));
    }

    return tx
      .select({
        id: careCircleMembers.id,
        patientId: careCircleMembers.patientId,
        invitedEmail: careCircleMembers.invitedEmail,
        relationship: careCircleMembers.relationship,
        priorityOrder: careCircleMembers.priorityOrder,
        status: careCircleMembers.status,
      })
      .from(careCircleMembers)
      .where(eq(careCircleMembers.memberUserId, ctx.userId));
  });

  return NextResponse.json({ members });
}

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const body = await request.json().catch(() => null);
  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid invite payload', details: parsed.error.flatten() },
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
      return { error: 'Only a patient can invite care circle members', status: 403 as const };
    }

    const existingUser = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, input.email.toLowerCase()))
      .limit(1);

    const rawInviteToken = randomBytes(16).toString('base64url');
    const inviteTokenHash = hashApiKey(rawInviteToken);
    const memberUserId = existingUser[0]?.id ?? null;

    const inserted = await tx
      .insert(careCircleMembers)
      .values({
        patientId: patient.id,
        memberUserId,
        invitedEmail: input.email.toLowerCase(),
        relationship: input.relationship,
        priorityOrder: input.priorityOrder,
        inviteTokenHash,
        status: memberUserId ? 'active' : 'pending',
      })
      .returning();

    const member = inserted[0]!;
    if (memberUserId) {
      const defaultScopes =
        input.relationship === 'clinician'
          ? ['vitals_read', 'alerts_receive', 'checkin_view', 'clinician_export']
          : ['vitals_read', 'alerts_receive', 'checkin_view'];

      await tx.insert(consentGrants).values({
        patientId: patient.id,
        granteeUserId: memberUserId,
        relationship: input.relationship === 'clinician' ? 'clinician' : 'caregiver',
        scopes: defaultScopes,
        reason: 'Care circle invitation accepted',
      });
    }

    await appendAuditLog(tx, {
      actorUserId: ctx.userId,
      action: 'care_circle.invite',
      targetType: 'care_circle_member',
      targetId: member.id,
      payload: {
        patientId: patient.id,
        relationship: input.relationship,
        linkedExistingUser: Boolean(memberUserId),
      },
    });

    return {
      status: 201 as const,
      member: {
        id: member.id,
        invitedEmail: member.invitedEmail,
        relationship: member.relationship,
        status: member.status,
      },
      inviteTokenPreview: memberUserId ? null : rawInviteToken,
    };
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result, { status: result.status });
}
