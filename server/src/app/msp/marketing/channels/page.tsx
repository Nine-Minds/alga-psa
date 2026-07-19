import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { listMarketingChannels } from '@alga-psa/marketing/actions';
import { ChannelsList } from '@alga-psa/marketing/components';
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

  let items: IMarketingChannel[] = [];
  try {
    items = await listMarketingChannels();
  } catch (err) {
    console.error('marketing channels: initial load failed', err);
  }

  return <ChannelsList items={items} />;
}

export const dynamic = 'force-dynamic';
