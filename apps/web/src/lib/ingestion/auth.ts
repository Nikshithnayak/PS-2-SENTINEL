import { NextResponse, type NextRequest } from 'next/server';
import { hashApiKey } from '@sentinel/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { withSystemDb } from '@/db';
import { apiKeys } from '@/db/schema';
import { getAccessiblePatientIds } from '@/lib/dashboard/queries';
import { checkPatientScope, getSessionContext, type SessionContext } from '@/lib/session';

export interface ResolvedIngestAuth {
  patientId: string;
  actorUserId: string | null;
  authMethod: 'api_key' | 'session';
  sessionCtx: SessionContext | null;
}

export type ResolveIngestAuthResult =
  | { auth: ResolvedIngestAuth; error?: never }
  | { auth?: never; error: NextResponse };

/**
 * Authenticates ingestion requests via either an active `x-api-key` scoped to a
 * patient profile or a verified user session with `vitals_read` scope.
 * When `requestedPatientId` is omitted, defaults to the API key's bound patient
 * or the user's primary accessible patient profile.
 */
export async function resolveIngestAuth(
  request: NextRequest,
  requestedPatientId?: string,
): Promise<ResolveIngestAuthResult> {
  const headerKey = request.headers.get('x-api-key');

  if (headerKey) {
    const hashed = hashApiKey(headerKey.trim());
    const rows = await withSystemDb((tx) =>
      tx
        .select({
          id: apiKeys.id,
          patientId: apiKeys.patientId,
          revokedAt: apiKeys.revokedAt,
        })
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, hashed), isNull(apiKeys.revokedAt)))
        .limit(1),
    );

    const keyRow = rows[0];
    if (!keyRow) {
      return { error: NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 }) };
    }
    if (requestedPatientId && keyRow.patientId !== requestedPatientId) {
      return {
        error: NextResponse.json({ error: 'API key not scoped to target patientId' }, { status: 403 }),
      };
    }

    await withSystemDb(async (tx) => {
      await tx.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyRow.id));
    });

    return {
      auth: {
        patientId: keyRow.patientId,
        actorUserId: null,
        authMethod: 'api_key',
        sessionCtx: null,
      },
    };
  }

  const ctx = await getSessionContext();
  if (!ctx) {
    return { error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  }

  const scoped = await resolveSessionPatientScope(ctx, requestedPatientId);
  if (scoped.error) return scoped;

  return {
    auth: {
      patientId: scoped.patientId,
      actorUserId: ctx.userId,
      authMethod: 'session',
      sessionCtx: ctx,
    },
  };
}

/**
 * Resolves `requestedPatientId` (or the caller's default accessible patient) for
 * an authenticated session and enforces `vitals_read` patient scope.
 */
export async function resolveSessionPatientScope(
  ctx: SessionContext,
  requestedPatientId?: string,
): Promise<{ patientId: string; error?: never } | { patientId?: never; error: NextResponse }> {
  let targetPatientId = requestedPatientId;
  if (!targetPatientId) {
    const accessible = await getAccessiblePatientIds(ctx);
    targetPatientId = accessible[0];
  }
  if (!targetPatientId) {
    return {
      error: NextResponse.json({ error: 'Target patientId required' }, { status: 400 }),
    };
  }

  const allowed = await checkPatientScope(ctx, targetPatientId, 'vitals_read');
  if (!allowed) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { patientId: targetPatientId };
}
