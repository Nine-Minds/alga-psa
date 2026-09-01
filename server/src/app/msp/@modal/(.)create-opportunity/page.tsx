import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import CreateOpportunityRouteClient from '../../_components/CreateOpportunityRouteClient';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.createOpportunity.title', { defaultValue: 'Create Opportunity' }),
  };
}

export default async function CreateOpportunityModalPage() {
  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  return (
    <WorkspaceRouteLayout>
      <CreateOpportunityRouteClient closeMode="back" />
    </WorkspaceRouteLayout>
  );
}
