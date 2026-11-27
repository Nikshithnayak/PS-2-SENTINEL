import { NextResponse, type NextRequest } from 'next/server';
import {
  disconnectGoogleConnector,
  getGoogleConnectorsStatus,
  resolveRequestOrigin,
  type GoogleHealthMode,
} from '@/lib/ingestion/connectors/google-cloud-health';
import { requireSession } from '@/lib/session';

export async function GET(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const status = await getGoogleConnectorsStatus(ctx.userId, resolveRequestOrigin(request));
  return NextResponse.json(status);
}

export async function DELETE(request: NextRequest) {
  const authRes = await requireSession();
  if (authRes.error) return authRes.error;
  const { ctx } = authRes;

  const rawMode = request.nextUrl.searchParams.get('mode');
  const mode: GoogleHealthMode =
    rawMode === 'google_health_api' || rawMode === 'health' ? 'google_health_api' : 'google_fit';

  await disconnectGoogleConnector(ctx.userId, mode);
  return NextResponse.json({ disconnected: true, mode });
}
