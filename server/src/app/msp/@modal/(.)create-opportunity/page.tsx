import type { Metadata } from 'next';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { featureFlags } from '@/lib/feature-flags/featureFlags';
import CreateOpportunityRouteClient from '../../_components/CreateOpportunityRouteClient';
import WorkspaceRouteLayout from '../../_components/WorkspaceRouteLayout';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'metadata');

  return {
    title: t('msp.createOpportunity.title', { defaultValue: 'Create Opportunity' }),
  };
}

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
