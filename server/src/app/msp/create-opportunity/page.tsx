import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import CreateOpportunityRouteClient from '../_components/CreateOpportunityRouteClient';

export const metadata: Metadata = {
  title: 'Create Opportunity',
};

export default async function CreateOpportunityPage() {
  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  return <CreateOpportunityRouteClient closeMode="replace" />;
}
