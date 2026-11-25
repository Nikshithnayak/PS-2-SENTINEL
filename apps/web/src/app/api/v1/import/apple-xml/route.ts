import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { withSystemDb } from '@/db';
import { patientProfiles } from '@/db/schema';
import { parseAppleHealthXmlStream } from '@/lib/ingestion/importers/apple-xml';
import { ingestVitalBatch } from '@/lib/ingestion/quality';
import { checkPatientScope, requireSession } from '@/lib/session';

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const formData = await request.formData().catch(() => null);
  const file = formData?.get('file');
  const requestedPatientId = formData?.get('patientId')?.toString();

  if (!file || typeof file === 'string' || typeof file.stream !== 'function') {
    return NextResponse.json({ error: 'Missing Apple Health export.xml file' }, { status: 400 });
  }
  const uploadedFile = file;

  let patientId = requestedPatientId;
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
    return NextResponse.json({ error: 'Target patientId required' }, { status: 400 });
  }

  const allowed = await checkPatientScope(ctx, patientId, 'vitals_read');
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  async function* streamChunks(): AsyncIterable<Uint8Array> {
    const reader = uploadedFile.stream().getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  }

  const parsed = await parseAppleHealthXmlStream(streamChunks());
  if (parsed.samples.length === 0) {
    return NextResponse.json(
      { error: 'No supported HealthKit <Record> elements found', stats: parsed.stats },
      { status: 400 },
    );
  }

  const batchResult = await ingestVitalBatch({
    patientId,
    source: 'apple_health_xml',
    samples: parsed.samples,
    actorUserId: ctx.userId,
    isSynthetic: false,
  });

  return NextResponse.json(
    {
      xmlStats: parsed.stats,
      ingest: batchResult,
    },
    { status: 201 },
  );
}
