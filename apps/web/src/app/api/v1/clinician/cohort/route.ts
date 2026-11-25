import { NextResponse } from 'next/server';
import { loadCohortSummaries } from '@/lib/dashboard/queries';
import { requireSession } from '@/lib/session';

export async function GET() {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;

  const cohort = await loadCohortSummaries(authRes.ctx);
  return NextResponse.json({ cohort });
}
