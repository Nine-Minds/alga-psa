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

  // One week back (published-recently), two weeks forward (agenda).
  const now = new Date();
  const dateFrom = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const dateTo = new Date(now.getTime() + 14 * 86_400_000).toISOString();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const rangeLabel = `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

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

  return (
    <MarketingCalendar
      awaiting={awaiting}
      items={items}
      channels={channels}
      rangeLabel={rangeLabel}
    />
  );
}

export const dynamic = 'force-dynamic';
