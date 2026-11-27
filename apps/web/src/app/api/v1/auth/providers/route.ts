import { NextResponse } from 'next/server';
import { getPublicAuthProvidersStatus } from '@/lib/auth-config';

export async function GET() {
  return NextResponse.json(getPublicAuthProvidersStatus());
}
