'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { OpdScribeWorkspace, type ScribeCohortOption } from '@/components/clinician/opd-scribe-workspace';
import { RoleWorkspaceGuard } from '@/components/health/role-gate';
import { SignedOutGate } from '@/components/health/signed-out-gate';
import { SentinelShell } from '@/components/sentinel-shell';

export default function ClinicianOpdScribePage() {
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);

  const cohortQuery = useQuery<{ cohort: ScribeCohortOption[] }>({
    queryKey: ['clinician-cohort'],
    queryFn: async () => {
      const res = await fetch('/api/v1/clinician/cohort');
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
  });

  const isUnauth = cohortQuery.error?.message === '401';

  return (
    <SentinelShell
      title="Ambient OPD Clinical Scribe"
      subtitle="Multilingual Indian OPD speech-to-text, SOAP notes, draft Rx & patient summary"
      rightSlot={
        <Link
          href="/clinician"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3.5 text-xs font-semibold hover:bg-[var(--bg-elevated)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Cohort Triage</span>
        </Link>
      }
    >
      <main className="space-y-6">
        <RoleWorkspaceGuard
          allowedRoles={['clinician', 'org_admin']}
          workspaceName="Ambient OPD Clinical Scribe"
        >
          {isUnauth ? (
            <SignedOutGate
              heading="Sign in to Clinician OPD Scribe"
              description="Reserved for verified physicians and clinical staff to record OPD consultations, draft prescriptions, and approve patient summaries."
              signInHref="/clinician/login"
              signInLabel="Open Clinician System Login"
            />
          ) : (
            <OpdScribeWorkspace
              cohort={cohortQuery.data?.cohort ?? []}
              selectedPatientId={selectedPatientId}
              onSelectPatient={(id) => setSelectedPatientId(id)}
            />
          )}
        </RoleWorkspaceGuard>
      </main>
    </SentinelShell>
  );
}
