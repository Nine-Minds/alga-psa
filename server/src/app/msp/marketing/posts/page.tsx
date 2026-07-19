import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import {
  getSocialPostQueue,
  listMarketingCampaigns,
  listMarketingChannels,
  listMarketingContent,
} from '@alga-psa/marketing/actions';
import { PostsQueue } from '@alga-psa/marketing/components';
import type {
  IMarketingCampaign,
  IMarketingChannel,
  IMarketingContent,
  ISocialPostQueueItem,
} from '@alga-psa/types';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Marketing Posts',
};

export default async function MarketingPostsPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/marketing/posts', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let items: ISocialPostQueueItem[] = [];
  let channels: IMarketingChannel[] = [];
  let campaigns: IMarketingCampaign[] = [];
  let content: IMarketingContent[] = [];
  try {
    [items, channels, campaigns, content] = await Promise.all([
      getSocialPostQueue(),
      listMarketingChannels(),
      listMarketingCampaigns(),
      listMarketingContent(),
    ]);
  } catch (err) {
    console.error('marketing posts: initial load failed', err);
  }

  return (
    <PostsQueue
      initialItems={items}
      channels={channels}
      campaigns={campaigns}
      content={content}
    />
  );
}

export const dynamic = 'force-dynamic';
