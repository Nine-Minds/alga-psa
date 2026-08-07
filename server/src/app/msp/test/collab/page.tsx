import { redirect } from 'next/navigation';
import { getSession, getSessionWithRevocationCheck } from '@alga-psa/auth';
import { Card } from '@alga-psa/ui/components/Card';
import CollabTestPageClient from './CollabTestPageClient';
import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.test.collab.title', { defaultValue: 'Collaboration Test' }),
  };
}

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
