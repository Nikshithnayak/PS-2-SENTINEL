import { NextResponse, type NextRequest } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAuditLog, getPool, withSystemDb } from '@/db';
import {
  medications,
  opdConsultations,
  vitalSamples,
  type OpdPatientSummaryData,
  type OpdPrescriptionItemData,
  type OpdSoapNoteData,
} from '@/db/schema';
import {
  generateOpdScribeDraft,
  OPD_SAMPLE_CONSULTATIONS,
  type OpdLanguageMix,
  type OpdPatientTelemetryContext,
} from '@/lib/clinician/opd-scribe';
import { loadPatientDashboard } from '@/lib/dashboard/queries';
import { lookupRxNormDrug } from '@/lib/meds/rxnorm';
import { checkPatientScope, requireSession } from '@/lib/session';

let opdTableEnsured = false;

async function ensureOpdConsultationsTable(): Promise<void> {
  if (opdTableEnsured) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS opd_consultations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      clinician_user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      patient_id uuid REFERENCES patient_profiles(id) ON DELETE SET NULL,
      patient_label text NOT NULL,
      language_mix text NOT NULL DEFAULT 'en_kn_hi',
      transcript text NOT NULL,
      soap_note jsonb NOT NULL,
      prescription_draft jsonb NOT NULL DEFAULT '[]'::jsonb,
      patient_summary jsonb NOT NULL,
      generator_source text NOT NULL DEFAULT 'deterministic_opd_nlp',
      status text NOT NULL DEFAULT 'draft',
      synced_medications_count integer NOT NULL DEFAULT 0,
      approved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_opd_consultations_clinician
      ON opd_consultations(clinician_user_id, created_at DESC);
  `);
  opdTableEnsured = true;
}

const SoapNoteSchema: z.ZodType<OpdSoapNoteData> = z.object({
  chiefComplaint: z.string().min(1).max(600),
  subjectiveHpi: z.string().min(1).max(4000),
  objectiveExam: z.string().min(1).max(4000),
  vitalsSummary: z.string().max(1500).default(''),
  assessment: z.string().min(1).max(2000),
  planAndFollowUp: z.string().min(1).max(3000),
  languagesDetected: z.array(z.string()).default(['English']),
  redFlags: z.array(z.string()).default([]),
  investigations: z.array(z.string()).default([]),
});

const PrescriptionItemSchema: z.ZodType<OpdPrescriptionItemData> = z.object({
  drugName: z.string().min(1).max(160),
  strength: z.string().min(1).max(80),
  route: z.string().min(1).max(60).default('Oral'),
  frequency: z.string().min(1).max(80),
  timing: z.string().min(1).max(80),
  durationDays: z.number().int().min(1).max(180),
  instructions: z.string().max(500).default(''),
  rxcui: z.string().nullable().default(null),
  affectsHeartRate: z.boolean().default(false),
});

const PatientSummarySchema: z.ZodType<OpdPatientSummaryData> = z.object({
  en: z.string().min(1).max(4000),
  kn: z.string().min(1).max(4000),
  hi: z.string().min(1).max(4000),
  followUpWhen: z.string().max(300).default('3–5 days'),
  warningSigns: z.array(z.string()).default([]),
});

const ScribePostSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('generate'),
    patientId: z.string().uuid().optional().nullable(),
    patientLabel: z.string().min(1).max(140).optional(),
    languageMix: z.enum(['en_kn_hi', 'en_kn', 'en_hi', 'en']).default('en_kn_hi'),
    transcript: z.string().min(8).max(12000),
  }),
  z.object({
    action: z.literal('approve'),
    consultationId: z.string().uuid(),
    soapNote: SoapNoteSchema,
    prescriptionDraft: z.array(PrescriptionItemSchema).max(25),
    patientSummary: PatientSummarySchema,
    syncMedications: z.boolean().default(true),
  }),
  z.object({
    action: z.literal('delete'),
    consultationId: z.string().uuid(),
  }),
]);

function frequencyToScheduleTimes(freq: string): string[] {
  const upper = freq.toUpperCase();
  if (upper.includes('1-1-1') || upper.includes('TDS')) return ['08:00', '14:00', '20:00'];
  if (upper.includes('1-0-1') || upper.includes('BD')) return ['08:00', '20:00'];
  if (upper.includes('0-0-1') || upper.includes('HS')) return ['21:30'];
  return ['08:00'];
}

function isClinicianRole(role: string): boolean {
  return role === 'clinician' || role === 'org_admin';
}

export async function GET(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  if (!isClinicianRole(ctx.role)) {
    return NextResponse.json(
      { error: 'Clinician Workstation access requires clinician or org_admin role.' },
      { status: 403 },
    );
  }

  await ensureOpdConsultationsTable();

  const patientId = request.nextUrl.searchParams.get('patientId') ?? undefined;
  if (patientId && !(await checkPatientScope(ctx, patientId, 'vitals_read'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rows = await withSystemDb((tx) => {
    const conds = [eq(opdConsultations.clinicianUserId, ctx.userId)];
    if (patientId) conds.push(eq(opdConsultations.patientId, patientId));
    return tx
      .select()
      .from(opdConsultations)
      .where(and(...conds))
      .orderBy(desc(opdConsultations.createdAt))
      .limit(20);
  });

  return NextResponse.json({
    consultations: rows,
    capabilities: {
      llmConfigured: false,
      extractorEngine: 'wispr_deterministic_opd',
    },
    sampleScenarios: OPD_SAMPLE_CONSULTATIONS,
  });
}

export async function POST(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  if (!isClinicianRole(ctx.role)) {
    return NextResponse.json(
      { error: 'Clinician Workstation access requires clinician or org_admin role.' },
      { status: 403 },
    );
  }

  await ensureOpdConsultationsTable();

  const raw = await request.json().catch(() => null);
  const parsed = ScribePostSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid OPD scribe request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.action === 'generate') {
    const genData = parsed.data;
    const patientId = genData.patientId ?? null;
    let telemetry: OpdPatientTelemetryContext | undefined;
    let patientLabel = genData.patientLabel?.trim() || 'Walk-in OPD Patient';

    if (patientId) {
      const allowed = await checkPatientScope(ctx, patientId, 'vitals_read');
      if (!allowed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const dash = await loadPatientDashboard(patientId);
      if (dash) {
        const wearableVitals = await withSystemDb(async (tx) => {
          const [rhr] = await tx
            .select({ value: vitalSamples.value })
            .from(vitalSamples)
            .where(and(eq(vitalSamples.patientId, patientId), eq(vitalSamples.metricType, 'resting_heart_rate')))
            .orderBy(desc(vitalSamples.recordedAt))
            .limit(1);
          const [spo2] = await tx
            .select({ value: vitalSamples.value })
            .from(vitalSamples)
            .where(and(eq(vitalSamples.patientId, patientId), eq(vitalSamples.metricType, 'spo2')))
            .orderBy(desc(vitalSamples.recordedAt))
            .limit(1);
          return { rhr: rhr?.value ?? null, spo2: spo2?.value ?? null };
        });

        patientLabel = `${dash.patientName} (${dash.ageBand})`;
        telemetry = {
          patientName: dash.patientName,
          ageBand: dash.ageBand,
          conditions: dash.conditionModules,
          latestLevel: dash.latestAssessment?.level ?? null,
          latestIndex: dash.latestAssessment?.deteriorationIndex ?? null,
          recentRhr: wearableVitals.rhr,
          recentSpo2: wearableVitals.spo2,
          partialNews2Score:
            (dash.latestAssessment?.partialNews2 as { partialScore?: number } | null)
              ?.partialScore ?? null,
          activeMeds: dash.medications.map((m) => `${m.name} (${m.dosage})`),
        };
      }
    }

    const generated = await generateOpdScribeDraft({
      transcript: genData.transcript,
      languageMix: genData.languageMix as OpdLanguageMix,
      telemetry,
    });

    const created = await withSystemDb(async (tx) => {
      const [row] = await tx
        .insert(opdConsultations)
        .values({
          clinicianUserId: ctx.userId,
          patientId,
          patientLabel,
          languageMix: genData.languageMix,
          transcript: genData.transcript.trim(),
          soapNote: generated.soapNote,
          prescriptionDraft: generated.prescriptionDraft,
          patientSummary: generated.patientSummary,
          generatorSource: generated.generatorSource,
          status: 'draft',
        })
        .returning();

      await appendAuditLog(tx, {
        actorUserId: ctx.userId,
        action: 'opd.scribe_draft_created',
        targetType: 'opd_consultation',
        targetId: row?.id ?? ctx.userId,
        payload: {
          patientId,
          patientLabel,
          generatorSource: generated.generatorSource,
          rxCount: generated.prescriptionDraft.length,
        },
      });
      return row;
    });

    return NextResponse.json(
      {
        consultation: created,
      },
      { status: 201 },
    );
  }

  if (parsed.data.action === 'delete') {
    const delData = parsed.data;
    const existing = await withSystemDb((tx) =>
      tx
        .select()
        .from(opdConsultations)
        .where(eq(opdConsultations.id, delData.consultationId))
        .limit(1),
    );
    if (!existing[0]) {
      return NextResponse.json({ error: 'Consultation not found' }, { status: 404 });
    }
    if (existing[0].clinicianUserId !== ctx.userId && ctx.role !== 'org_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await withSystemDb(async (tx) => {
      await tx.delete(opdConsultations).where(eq(opdConsultations.id, delData.consultationId));
      await appendAuditLog(tx, {
        actorUserId: ctx.userId,
        action: 'opd.consultation_deleted',
        targetType: 'opd_consultation',
        targetId: delData.consultationId,
        payload: { patientId: existing[0]!.patientId },
      });
    });

    return NextResponse.json({ deleted: true });
  }

  // Approve & sign consultation + optional Rx medication sync to patient regimen
  const approveData = parsed.data;
  const [existing] = await withSystemDb((tx) =>
    tx
      .select()
      .from(opdConsultations)
      .where(eq(opdConsultations.id, approveData.consultationId))
      .limit(1),
  );
  if (!existing) {
    return NextResponse.json({ error: 'Consultation not found' }, { status: 404 });
  }
  if (existing.clinicianUserId !== ctx.userId && ctx.role !== 'org_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (existing.patientId && !(await checkPatientScope(ctx, existing.patientId, 'vitals_read'))) {
    return NextResponse.json({ error: 'Patient consent revoked or forbidden' }, { status: 403 });
  }

  // Refresh RxNorm lookup for any clinician-added or edited drugs before signing
  const finalizedRx: OpdPrescriptionItemData[] = await Promise.all(
    approveData.prescriptionDraft.map(async (item) => {
      if (item.rxcui) return item;
      const rx = await lookupRxNormDrug(item.drugName);
      return {
        ...item,
        drugName: rx.normalizedName || item.drugName,
        rxcui: rx.rxcui,
        affectsHeartRate: item.affectsHeartRate || rx.affectsHeartRate,
      };
    }),
  );

  const now = new Date();
  let syncedMedicationsCount = 0;

  const updated = await withSystemDb(async (tx) => {
    if (approveData.syncMedications && existing.patientId && finalizedRx.length > 0) {
      for (const rxItem of finalizedRx) {
        const dup = await tx
          .select({ id: medications.id })
          .from(medications)
          .where(
            and(
              eq(medications.patientId, existing.patientId),
              eq(medications.name, rxItem.drugName),
              eq(medications.active, true),
            ),
          )
          .limit(1);
        if (!dup[0]) {
          await tx.insert(medications).values({
            patientId: existing.patientId,
            name: rxItem.drugName,
            rxcui: rxItem.rxcui,
            dosage: `${rxItem.strength} · ${rxItem.frequency} (${rxItem.timing})`,
            scheduleTimes: frequencyToScheduleTimes(rxItem.frequency),
            affectsHeartRate: rxItem.affectsHeartRate,
            active: true,
          });
          syncedMedicationsCount += 1;
        }
      }
    }

    const [saved] = await tx
      .update(opdConsultations)
      .set({
        soapNote: approveData.soapNote,
        prescriptionDraft: finalizedRx,
        patientSummary: approveData.patientSummary,
        status: 'approved',
        syncedMedicationsCount,
        approvedAt: now,
        updatedAt: now,
      })
      .where(eq(opdConsultations.id, existing.id))
      .returning();

    await appendAuditLog(tx, {
      actorUserId: ctx.userId,
      action: 'opd.consultation_approved',
      targetType: 'opd_consultation',
      targetId: existing.id,
      payload: {
        patientId: existing.patientId,
        rxCount: finalizedRx.length,
        syncedMedicationsCount,
      },
    });

    return saved;
  });

  return NextResponse.json({
    consultation: updated,
    syncedMedicationsCount,
  });
}
