import type { NextRequest } from 'next/server';
import { toNextJsHandler } from 'better-auth/next-js';
import { handleGoogleConnectorCallback } from '@/lib/ingestion/connectors/google-callback-handler';
import { auth } from '@/lib/auth';

const authHandlers = toNextJsHandler(auth);

export async function GET(request: NextRequest) {
  const state = request.nextUrl.searchParams.get('state') ?? '';
  if (
    request.nextUrl.pathname.endsWith('/api/auth/callback/google') &&
    state.startsWith('gfit_')
  ) {
    return handleGoogleConnectorCallback(request);
  }
  return authHandlers.GET(request);
}

export const POST = authHandlers.POST;
