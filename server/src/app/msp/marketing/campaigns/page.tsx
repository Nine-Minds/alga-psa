import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { getMarketingAccess } from '@alga-psa/marketing/actions';
import { listMarketingCampaigns } from '@alga-psa/marketing/actions';
import { CampaignsList, MarketingAccessBoundary } from '@alga-psa/marketing/components';
import type { IMarketingCampaign } from '@alga-psa/types';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Marketing Campaigns',
};

export default async function MarketingCampaignsPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/marketing/campaigns', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  // M10: a failed guard renders a boundary, not a fake-working empty module.
  const access = await getMarketingAccess();
  if (!access.allowed) {
    return <MarketingAccessBoundary reason={access.reason ?? 'permission'} />;
  }

  let items: IMarketingCampaign[] = [];
  try {
    items = await listMarketingCampaigns();
  } catch (err) {
    console.error('marketing campaigns: initial load failed', err);
  }

  return <CampaignsList items={items} />;
}

export const dynamic = 'force-dynamic';
