import { NextResponse } from 'next/server';
import { desc, eq, isNull } from 'drizzle-orm';
import { appendAuditLog, withSystemDb } from '@/db';
import { baselineStates, consentGrants, patientProfiles, riskAssessments } from '@/db/schema';
import { pseudonymizeId } from '@/lib/exports/fhir';
import { requireSession } from '@/lib/session';

export async function GET() {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  if (ctx.role !== 'org_admin' && ctx.role !== 'clinician') {
    return NextResponse.json(
      { error: 'Only org_admin or consented clinician roles may export de-identified research cohorts' },
      { status: 403 },
    );
  }

  const cohortRows = await withSystemDb(async (tx) => {
    const profiles = await tx
      .select({
        id: patientProfiles.id,
        ageBand: patientProfiles.ageBand,
        sex: patientProfiles.sex,
        conditionModules: patientProfiles.conditionModules,
        isSynthetic: patientProfiles.isSynthetic,
      })
      .from(patientProfiles)
      .where(isNull(patientProfiles.deletedAt));

    const grants = await tx
      .select()
      .from(consentGrants)
      .where(isNull(consentGrants.withdrawnAt));

    const consentedIds = new Set(
      grants
        .filter((g) => (g.scopes as string[]).includes('clinician_export'))
        .map((g) => g.patientId),
    );

    const out = [];
    for (const p of profiles) {
      // Clinician must hold clinician_export grant; org_admin exports only non-deleted records
      if (ctx.role === 'clinician' && !consentedIds.has(p.id)) {
        continue;
      }

      const [latestRisk] = await tx
        .select({
          deteriorationIndex: riskAssessments.deteriorationIndex,
          level: riskAssessments.level,
          l1Score: riskAssessments.l1Score,
          l2Score: riskAssessments.l2Score,
          l3Score: riskAssessments.l3Score,
          isSynthetic: riskAssessments.isSynthetic,
        })
        .from(riskAssessments)
        .where(eq(riskAssessments.patientId, p.id))
        .orderBy(desc(riskAssessments.assessedAt))
        .limit(1);

      const baselines = await tx
        .select({
          metricType: baselineStates.metricType,
          validDays: baselineStates.validDays,
          status: baselineStates.status,
        })
        .from(baselineStates)
        .where(eq(baselineStates.patientId, p.id))
        .orderBy(desc(baselineStates.validDays));

      out.push({
        studyParticipantId: pseudonymizeId(p.id),
        ageBand: p.ageBand,
        sex: p.sex,
        conditionModules: p.conditionModules,
        maxBaselineValidDays: baselines[0]?.validDays ?? 0,
        baselineStage: baselines[0]?.status ?? 'warming_prior',
        latestDeteriorationIndex: latestRisk?.deteriorationIndex ?? null,
        latestLevel: latestRisk?.level ?? null,
        l1Score: latestRisk?.l1Score ?? null,
        l2Score: latestRisk?.l2Score ?? null,
        l3Score: latestRisk?.l3Score ?? null,
        isSynthetic: Boolean(p.isSynthetic || latestRisk?.isSynthetic),
      });
    }

    await appendAuditLog(tx, {
      actorUserId: ctx.userId,
      action: 'export.deidentified_cohort',
      targetType: 'cohort',
      targetId: 'research_cohort',
      payload: { recordCount: out.length, role: ctx.role },
    });

    return out;
  });

  return NextResponse.json(
    {
      exportedAt: new Date().toISOString(),
      deidentificationStandard: 'HIPAA Safe Harbor + DPDP Act 2023 Pseudonymous Export',
      piiFieldsIncluded: [],
      records: cohortRows,
    },
    {
      headers: {
        'content-disposition': 'attachment; filename="sentinel-deidentified-cohort.json"',
      },
    },
  );
}
