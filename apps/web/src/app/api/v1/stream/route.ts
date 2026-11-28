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
      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        clearTimeout(gracefulCloseTimer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          cleanup();
        }
      };

      // Hint browser EventSource to reconnect cleanly after graceful serverless rotation
      try {
        controller.enqueue(encoder.encode('retry: 2000\n\n'));
      } catch {
        // Ignore
      }

      send('connected', { patientId: targetPatientId, timestamp: new Date().toISOString() });

      const unsubscribe = subscribePatientEvents(targetPatientId, (evt) => {
        send(evt.type, evt);
      });

      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          cleanup();
        }
      }, 15_000);

      // Rotate stream cleanly before Vercel's serverless timeout (300s) so EventSource reconnects without 5xx logs
      const gracefulCloseTimer = setTimeout(() => {
        cleanup();
      }, 45_000);

      request.signal.addEventListener('abort', cleanup);
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
