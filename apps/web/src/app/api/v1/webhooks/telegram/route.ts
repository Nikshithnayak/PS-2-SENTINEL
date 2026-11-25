import { NextResponse, type NextRequest } from 'next/server';
import { desc, inArray } from 'drizzle-orm';
import { withSystemDb } from '@/db';
import { alerts } from '@/db/schema';
import { applyAlertAction } from '@/lib/alerts/outbox';
import { parseCaregiverReplyCommand } from '@/lib/alerts/reply-parser';

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const incomingSecret = request.headers.get('x-telegram-bot-api-secret-token');
  if (expectedSecret && incomingSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Invalid Telegram webhook secret' }, { status: 401 });
  }

  const update = (await request.json().catch(() => null)) as {
    message?: { text?: string; from?: { username?: string; first_name?: string } };
    callback_query?: { data?: string; from?: { username?: string } };
  } | null;

  const rawText = update?.callback_query?.data ?? update?.message?.text ?? '';
  const cleaned = rawText.replace(/^\//, '').trim();
  const normalized = cleaned.toLowerCase().startsWith('callme') ? 'CALL ME' : cleaned;
  const command = parseCaregiverReplyCommand(normalized);

  if (!command) {
    return NextResponse.json({ ok: true, ignored: true, reason: 'Unsupported bot command' });
  }

  const [target] = await withSystemDb((tx) =>
    tx
      .select({ id: alerts.id })
      .from(alerts)
      .where(inArray(alerts.status, ['open', 'escalated', 'snoozed']))
      .orderBy(desc(alerts.createdAt))
      .limit(1),
  );

  if (!target) {
    return NextResponse.json({ ok: true, updated: false, reason: 'No open alert' });
  }

  const updated = await applyAlertAction({
    alertId: target.id,
    actorUserId: null,
    action: command,
    note: `Telegram command (${rawText}) by @${update?.message?.from?.username ?? update?.callback_query?.from?.username ?? 'telegram'}`,
  });

  return NextResponse.json({ ok: true, parsedCommand: command, updated });
}
