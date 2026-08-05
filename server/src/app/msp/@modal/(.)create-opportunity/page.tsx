import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { featureFlags } from '@/lib/feature-flags/featureFlags';
import CreateOpportunityRouteClient from '../../_components/CreateOpportunityRouteClient';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

export const metadata: Metadata = {
  title: 'Create Opportunity',
};

export default async function CreateOpportunityModalPage() {
  // Same gate as the full-page route: the flag hides the menu entry, and the
  // route refuses direct navigation while the module is off.
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

  return (
    <WorkspaceRouteLayout>
      <CreateOpportunityRouteClient closeMode="back" />
    </WorkspaceRouteLayout>
  );
}
