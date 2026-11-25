import { type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { withSystemDb } from '@/db';
import { patientProfiles } from '@/db/schema';
import { subscribePatientEvents } from '@/lib/alerts/events';
import { checkPatientScope, requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  let patientId = request.nextUrl.searchParams.get('patientId') ?? undefined;
  if (!patientId) {
    const own = await withSystemDb((tx) =>
      tx
        .select({ id: patientProfiles.id })
        .from(patientProfiles)
        .where(eq(patientProfiles.userId, ctx.userId))
        .limit(1),
    );
    patientId = own[0]?.id;
  }
  if (!patientId) {
    return new Response('patientId required', { status: 400 });
  }

  const canAlert = await checkPatientScope(ctx, patientId, 'alerts_receive');
  const canRead = await checkPatientScope(ctx, patientId, 'vitals_read');
  if (!canAlert && !canRead) {
    return new Response('Forbidden', { status: 403 });
  }

  const encoder = new TextEncoder();
  const targetPatientId = patientId;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Stream closed
        }
      };

      send('connected', { patientId: targetPatientId, timestamp: new Date().toISOString() });

      const unsubscribe = subscribePatientEvents(targetPatientId, (evt) => {
        send(evt.type, evt);
      });

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(keepalive);
        }
      }, 15_000);

      request.signal.addEventListener('abort', () => {
        clearInterval(keepalive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
