import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { PORTAL_ROLE_COOKIE, signPortalRoleIntent } from '@/lib/auth-portal';

const PortalIntentSchema = z.object({
  role: z.enum(['patient', 'caregiver', 'clinician']),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = PortalIntentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid portal role' }, { status: 400 });
  }

  const token = signPortalRoleIntent(parsed.data.role);
  const res = NextResponse.json({ ok: true, role: parsed.data.role });
  res.cookies.set(PORTAL_ROLE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 15 * 60,
  });
  return res;
}
