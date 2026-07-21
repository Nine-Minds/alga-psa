import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { getMarketingAccess } from '@alga-psa/marketing/actions';
import { listMarketingChannels } from '@alga-psa/marketing/actions';
import { ChannelsList, MarketingAccessBoundary } from '@alga-psa/marketing/components';
import type { IMarketingChannel } from '@alga-psa/types';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Marketing Channels',
};

export default async function MarketingChannelsPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/marketing/channels', scope: 'msp' });
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

  let items: IMarketingChannel[] = [];
  try {
    items = await listMarketingChannels();
  } catch (err) {
    console.error('marketing channels: initial load failed', err);
  }

  return <ChannelsList items={items} />;
}

export const dynamic = 'force-dynamic';
