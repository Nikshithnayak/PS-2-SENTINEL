import { NextResponse, type NextRequest } from 'next/server';
import { generateApiKey } from '@sentinel/shared';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog, withSystemDb } from '@/db';
import { apiKeys, patientProfiles } from '@/db/schema';
import { requireSession } from '@/lib/session';

const CreateKeySchema = z.object({
  name: z.string().min(2).max(80),
});

export async function GET() {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const keys = await withSystemDb(async (tx) => {
    const profile = await tx
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.userId, ctx.userId))
      .limit(1);
    if (!profile[0]) return [];
    return tx
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.patientId, profile[0].id))
      .orderBy(desc(apiKeys.createdAt));
  });

  return NextResponse.json({ keys });
}

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const body = await request.json().catch(() => null);
  const parsed = CreateKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid API key name' }, { status: 400 });
  }

  const created = await withSystemDb(async (tx) => {
    const profile = await tx
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.userId, ctx.userId))
      .limit(1);
    if (!profile[0]) return null;

    const { rawKey, prefix, hash } = generateApiKey();
    const inserted = await tx
      .insert(apiKeys)
      .values({
        patientId: profile[0].id,
        name: parsed.data.name,
        keyPrefix: prefix,
        keyHash: hash,
        scopes: ['ingest:write'],
      })
      .returning();

    await appendAuditLog(tx, {
      actorUserId: ctx.userId,
      action: 'api_key.create',
      targetType: 'api_key',
      targetId: inserted[0]!.id,
      payload: { name: parsed.data.name, keyPrefix: prefix },
    });

    return { key: inserted[0]!, plaintextOnce: rawKey };
  });

  if (!created) {
    return NextResponse.json({ error: 'Only patients can generate device API keys' }, { status: 403 });
  }

  return NextResponse.json(created, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const keyId = request.nextUrl.searchParams.get('id');
  if (!keyId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  await withSystemDb(async (tx) => {
    const profile = await tx
      .select({ id: patientProfiles.id })
      .from(patientProfiles)
      .where(eq(patientProfiles.userId, ctx.userId))
      .limit(1);
    if (!profile[0]) return;
    await tx
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, keyId), eq(apiKeys.patientId, profile[0].id)));
  });

  return NextResponse.json({ revoked: true });
}
