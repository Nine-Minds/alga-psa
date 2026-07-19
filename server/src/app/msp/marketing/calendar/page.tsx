import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { getMarketingAccess } from '@alga-psa/marketing/actions';
import {
  getAwaitingPublishQueue,
  getMarketingCalendarItems,
} from '@alga-psa/marketing/actions';
import { listMarketingChannels } from '@alga-psa/marketing/actions';
import { MarketingCalendar, MarketingAccessBoundary } from '@alga-psa/marketing/components';
import type { IMarketingChannel, ISocialPostQueueItem } from '@alga-psa/types';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Marketing Calendar',
};

export default async function MarketingCalendarPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/marketing/calendar', scope: 'msp' });
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

  // Wide enough for both views: the agenda (a week back for
  // published-recently, two weeks forward) and the current-month grid.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const dateFrom = new Date(Math.min(monthStart.getTime() - 7 * 86_400_000, now.getTime() - 7 * 86_400_000)).toISOString();
  const dateTo = new Date(Math.max(monthEnd.getTime() + 7 * 86_400_000, now.getTime() + 14 * 86_400_000)).toISOString();

  let awaiting: ISocialPostQueueItem[] = [];
  let items: ISocialPostQueueItem[] = [];
  let channels: IMarketingChannel[] = [];
  try {
    [awaiting, items, channels] = await Promise.all([
      getAwaitingPublishQueue(),
      getMarketingCalendarItems(dateFrom, dateTo),
      listMarketingChannels(true),
    ]);
  } catch (err) {
    console.error('marketing calendar: initial load failed', err);
  }

  return <MarketingCalendar awaiting={awaiting} items={items} channels={channels} />;
}

export const dynamic = 'force-dynamic';
