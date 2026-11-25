import { NextResponse } from 'next/server';
import { verifyAuditChain } from '@sentinel/shared';
import { asc } from 'drizzle-orm';
import { withSystemDb } from '@/db';
import { auditLogs } from '@/db/schema';
import { requireSession } from '@/lib/session';

export async function GET() {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;

  const { entries, verification } = await withSystemDb(async (tx) => {
    const rows = await tx
      .select()
      .from(auditLogs)
      .orderBy(asc(auditLogs.seq))
      .limit(500);

    const normalized = rows.map((r) => ({
      seq: Number(r.seq),
      prevHash: r.prevHash,
      entryHash: r.entryHash,
      actorUserId: r.actorUserId,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      payloadJson: r.payloadJson,
      createdAtIso: r.createdAt.toISOString(),
    }));

    return {
      entries: normalized.slice(-25).reverse(),
      verification: verifyAuditChain(normalized),
    };
  });

  return NextResponse.json({
    totalChecked: entries.length,
    chainValid: verification.valid,
    brokenAtSeq: verification.brokenAtSeq ?? null,
    recentEntries: entries,
  });
}
