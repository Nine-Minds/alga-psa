import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { featureFlags } from '@/lib/feature-flags/featureFlags';
import CreateOpportunityRouteClient from '../_components/CreateOpportunityRouteClient';

export const metadata: Metadata = {
  title: 'Create Opportunity',
};

export default async function CreateOpportunityPage() {
  // The header menu hides this entry point when the module flag is off; the
  // route itself must enforce the same gate for direct navigation.
  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }
  const opportunitiesEnabled = await featureFlags.isEnabled('opportunities-module', {
    userId: session.user.id,
    tenantId: session.user.tenant,
    userRole: session.user.user_type,
  });
  if (!opportunitiesEnabled) {
    redirect('/msp/dashboard');
  }

  return <CreateOpportunityRouteClient closeMode="replace" />;
}
