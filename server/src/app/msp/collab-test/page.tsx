import { redirect } from 'next/navigation';
import { getSession, getSessionWithRevocationCheck } from '@alga-psa/auth';
import { Card } from '@alga-psa/ui/components/Card';
import { featureFlags } from '@/lib/feature-flags/featureFlags';
import CollabTestPageClient from './CollabTestPageClient';

export default async function CollabTestPage() {
  const session =
    (await getSessionWithRevocationCheck()) ??
    (process.env.NODE_ENV !== 'production' ? await getSession() : null);

  if (!session) {
    redirect('/auth/msp/signin');
  }

  const isEnabled = await featureFlags.isEnabled('collaborative_editing', {
    userId: session.user.id,
    tenantId: session.user.tenant,
    userRole: session.user.user_type,
  });

  if (!isEnabled) {
    return (
      <Card className="p-4 text-sm text-[rgb(var(--color-text-600))]">
        Feature not available.
      </Card>
    );
  }

  if (!session.user.tenant) {
    return (
      <Card className="p-4 text-sm text-red-500">
        Missing tenant context for collaborative editing.
      </Card>
    );
  }

  return (
    <CollabTestPageClient
      userId={session.user.id}
      userName={session.user.name}
      tenantId={session.user.tenant}
    />
  );
}
