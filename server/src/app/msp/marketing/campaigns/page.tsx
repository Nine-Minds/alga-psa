import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { listMarketingCampaigns } from '@alga-psa/marketing/actions';
import { CampaignsList } from '@alga-psa/marketing/components';
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

  let items: IMarketingCampaign[] = [];
  try {
    items = await listMarketingCampaigns();
  } catch (err) {
    console.error('marketing campaigns: initial load failed', err);
  }

  return <CampaignsList items={items} />;
}

export const dynamic = 'force-dynamic';
