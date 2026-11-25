import { NextResponse, type NextRequest } from 'next/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { withSystemDb } from '@/db';
import { alerts, patientProfiles } from '@/db/schema';
import { applyAlertAction } from '@/lib/alerts/outbox';
import { parseCaregiverReplyCommand } from '@/lib/alerts/reply-parser';
import { getAccessiblePatientIds } from '@/lib/dashboard/queries';
import { getSessionContext } from '@/lib/session';

const InboxReplySchema = z.object({
  alertId: z.string().uuid().optional(),
  patientId: z.string().uuid().optional(),
  fromEmail: z.string().email().optional(),
  bodyText: z.string().min(1).max(2000),
});

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.INBOX_WEBHOOK_SECRET ?? process.env.BETTER_AUTH_SECRET;
  const headerSecret = request.headers.get('x-inbox-secret');
  const sessionCtx = await getSessionContext();

  const authorizedByWorkerSecret = Boolean(
    configuredSecret && headerSecret && headerSecret === configuredSecret,
  );
  if (!authorizedByWorkerSecret && !sessionCtx) {
    return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
  }

  const raw = await request.json().catch(() => null);
  const parsed = InboxReplySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid reply webhook payload' }, { status: 400 });
  }

  const command = parseCaregiverReplyCommand(parsed.data.bodyText);
  if (!command) {
    return NextResponse.json(
      { error: 'Unrecognized reply command. Expected OK, CALL ME, or SNOOZE.' },
      { status: 400 },
    );
  }

  let targetAlertId = parsed.data.alertId;
  if (!targetAlertId) {
    const patientId =
      parsed.data.patientId ??
      (sessionCtx ? (await getAccessiblePatientIds(sessionCtx))[0] : undefined) ??
      (await withSystemDb((tx) => tx.select({ id: patientProfiles.id }).from(patientProfiles).limit(1)))[0]
        ?.id;

    if (!patientId) {
      return NextResponse.json({ error: 'No target patient or alert found' }, { status: 404 });
    }

    const [latestOpen] = await withSystemDb((tx) =>
      tx
        .select({ id: alerts.id })
        .from(alerts)
        .where(inArray(alerts.status, ['open', 'escalated', 'snoozed']))
        .orderBy(desc(alerts.createdAt))
        .limit(1),
    );
    targetAlertId = latestOpen?.id;
    if (!targetAlertId) {
      const [anyRecent] = await withSystemDb((tx) =>
        tx
          .select({ id: alerts.id })
          .from(alerts)
          .where(eq(alerts.patientId, patientId))
          .orderBy(desc(alerts.createdAt))
          .limit(1),
      );
      targetAlertId = anyRecent?.id;
    }
  }

  if (!targetAlertId) {
    return NextResponse.json({ error: 'No matching alert to update' }, { status: 404 });
  }

  const result = await applyAlertAction({
    alertId: targetAlertId,
    actorUserId: sessionCtx?.userId ?? null,
    action: command,
    note: `Email reply (${command}): "${parsed.data.bodyText.slice(0, 120)}" from ${parsed.data.fromEmail ?? 'inbox-worker'}`,
  });

  return NextResponse.json({
    parsedCommand: command,
    ...result,
  });
}
