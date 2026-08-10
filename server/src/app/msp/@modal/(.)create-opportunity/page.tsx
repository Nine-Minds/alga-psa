import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import CreateOpportunityRouteClient from '../../_components/CreateOpportunityRouteClient';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

export const metadata: Metadata = {
  title: 'Create Opportunity',
};

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
