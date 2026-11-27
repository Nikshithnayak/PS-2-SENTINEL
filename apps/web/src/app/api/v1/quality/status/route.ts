import { NextResponse, type NextRequest } from 'next/server';
import { desc, eq, sql } from 'drizzle-orm';
import { withSystemDb } from '@/db';
import {
  environmentSnapshots,
  ingestBatches,
  patientProfiles,
  vitalRollupsHourly,
  vitalSamples,
} from '@/db/schema';
import {
  GoogleFitAdapter,
  GoogleHealthAdapter,
  OpenWearablesAdapter,
} from '@/lib/ingestion/adapters/providers';
import {
  getGoogleConnectorsStatus,
  resolveRequestOrigin,
} from '@/lib/ingestion/connectors/google-cloud-health';
import { evaluateDeviceSilence } from '@/lib/ingestion/quality';
import { checkPatientScope, requireSession } from '@/lib/session';

export async function GET(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  let patientId = request.nextUrl.searchParams.get('patientId');
  if (!patientId) {
    const own = await withSystemDb((tx) =>
      tx
        .select({ id: patientProfiles.id })
        .from(patientProfiles)
        .where(eq(patientProfiles.userId, ctx.userId))
        .limit(1),
    );
    if (own[0]) {
      patientId = own[0].id;
    } else {
      // Caregiver/clinician fallback to first consented patient
      const first = await withSystemDb((tx) =>
        tx.select({ id: patientProfiles.id }).from(patientProfiles).limit(1),
      );
      patientId = first[0]?.id ?? null;
    }
  }

  if (!patientId) {
    return NextResponse.json({ error: 'No patient profile found' }, { status: 404 });
  }

  const allowed = await checkPatientScope(ctx, patientId, 'vitals_read');
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const silence = await evaluateDeviceSilence(patientId);
  const gf = new GoogleFitAdapter().healthCheck();
  const gh = new GoogleHealthAdapter().healthCheck();
  const ow = new OpenWearablesAdapter().healthCheck();
  const googleConnectors = await getGoogleConnectorsStatus(ctx.userId, resolveRequestOrigin(request));

  const summary = await withSystemDb(async (tx) => {
    const batches = await tx
      .select()
      .from(ingestBatches)
      .where(eq(ingestBatches.patientId, patientId))
      .orderBy(desc(ingestBatches.createdAt))
      .limit(15);

    const counts = await tx
      .select({
        totalSamples: sql<number>`count(*)::int`,
        syntheticSamples: sql<number>`count(*) filter (where ${vitalSamples.isSynthetic})::int`,
        motionArtifacts: sql<number>`count(*) filter (where ${vitalSamples.qualityFlags} ? 'motion_artifact')::int`,
      })
      .from(vitalSamples)
      .where(eq(vitalSamples.patientId, patientId));

    const rollupCount = await tx
      .select({ cnt: sql<number>`count(*)::int` })
      .from(vitalRollupsHourly)
      .where(eq(vitalRollupsHourly.patientId, patientId));

    const env = await tx
      .select()
      .from(environmentSnapshots)
      .orderBy(desc(environmentSnapshots.fetchedAt))
      .limit(1);

    return {
      batches,
      counts: counts[0] ?? { totalSamples: 0, syntheticSamples: 0, motionArtifacts: 0 },
      hourlyRollupCount: Number(rollupCount[0]?.cnt ?? 0),
      environment: env[0] ?? null,
    };
  });

  return NextResponse.json({
    patientId,
    silence,
    adapters: [gf, gh, ow],
    googleConnectors,
    ...summary,
  });
}
