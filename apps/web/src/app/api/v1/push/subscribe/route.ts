import { NextResponse, type NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { withSystemDb } from '@/db';
import { pushSubscriptions } from '@/db/schema';
import { resolveVapidConfig } from '@/lib/alerts/env-config';
import { requireSession } from '@/lib/session';

const SubscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(8),
    auth: z.string().min(4),
  }),
});

export async function GET() {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;

  const vapid = resolveVapidConfig();
  return NextResponse.json({
    vapidConfigured: Boolean(vapid.publicKey && vapid.privateKey),
    vapidPublicKey: vapid.publicKey,
    source: vapid.source,
  });
}

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const body = await request.json().catch(() => null);
  const parsed = SubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid push subscription' }, { status: 400 });
  }

  await withSystemDb(async (tx) => {
    const existing = await tx
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.userId, ctx.userId),
          eq(pushSubscriptions.endpoint, parsed.data.endpoint),
        ),
      )
      .limit(1);

    if (!existing[0]) {
      await tx.insert(pushSubscriptions).values({
        userId: ctx.userId,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
      });
    }
  });

  return NextResponse.json({ subscribed: true }, { status: 201 });
}
