import { redirect } from 'next/navigation';
import { getSession, getSessionWithRevocationCheck } from '@alga-psa/auth';
import { Card } from '@alga-psa/ui/components/Card';
import CollabTestPageClient from './CollabTestPageClient';


export const metadata = {
  title: 'Collaboration Test',
};

export default async function CollabTestPage() {
  const session =
    (await getSessionWithRevocationCheck()) ??
    (process.env.NODE_ENV !== 'production' ? await getSession() : null);

  if (!session) {
    redirect('/auth/msp/signin');
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
