import { redirect } from 'next/navigation';
import { getPortalConfig, portalForRole } from '@/lib/auth-portal';
import { getSessionContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function RootPage() {
  const session = await getSessionContext();
  if (session) {
    redirect(getPortalConfig(portalForRole(session.role)).homeHref);
  }
  redirect('/auth');
}
