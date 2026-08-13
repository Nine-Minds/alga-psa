import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@alga-psa/auth';
import { getWorkQueue, listOpportunities } from '@alga-psa/opportunities/actions';
import { DEFAULT_OPPORTUNITY_PAGE_SIZE } from '@alga-psa/opportunities/lib/opportunityListPaging';
import { getOpportunityDraftingAvailability } from '@enterprise/lib/opportunities/draftingActions';
import { getManagementAvailability } from '@enterprise/lib/opportunities/actions';
import { OpportunityForecastView } from '@/components/opportunities/OpportunityForecastView';
import { OpportunityMeetingMode } from '@/components/opportunities/OpportunityMeetingMode';
import { OpportunitiesHubHost } from '@/components/opportunities/OpportunitiesHubHost';
import { getAllClients } from '@alga-psa/clients/actions';
import type { IClient, IOpportunityListItem, IWorkQueue } from '@alga-psa/types';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';
import { getServerTranslation } from '@alga-psa/ui/lib/i18n/serverOnly';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslation(undefined, 'msp/opportunities');
  return { title: t('opportunities.pageTitle', 'Opportunities') };
}

export default async function OpportunitiesPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/opportunities', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let items: IOpportunityListItem[] = [];
  let total = 0;
  let clients: IClient[] = [];
  let queue: IWorkQueue | null = null;
  // Load independently so one failure (e.g. a missing opportunities permission)
  // doesn't blank the others — an empty clients list breaks the create dialog.
  const [listResult, clientsResult, queueResult] = await Promise.allSettled([
    listOpportunities({ status: 'all', page: 1, page_size: DEFAULT_OPPORTUNITY_PAGE_SIZE }),
    getAllClients(false),
    getWorkQueue(),
  ]);
  if (listResult.status === 'fulfilled') {
    items = listResult.value.data;
    total = listResult.value.total;
  } else {
    console.error('opportunities: list load failed', listResult.reason);
  }
  if (clientsResult.status === 'fulfilled') {
    clients = clientsResult.value;
  } else {
    console.error('opportunities: clients load failed', clientsResult.reason);
  }
  if (queueResult.status === 'fulfilled') {
    queue = queueResult.value;
  } else {
    console.error('opportunities: work queue load failed', queueResult.reason);
  }

  if (!queue) {
    const firstName = (session.user as any).first_name ?? (session.user.name ?? '').split(' ')[0] ?? '';
    queue = {
      user_first_name: firstName,
      date: new Date().toISOString(),
      found_totals: [],
      do_today: [],
      going_quiet: [],
      money_found: [],
      lesson: null,
    };
  }

  const [draftingAvailable, managementAvailable] = await Promise.all([
    getOpportunityDraftingAvailability().catch(() => false),
    getManagementAvailability().catch(() => false),
  ]);
  const { t } = await getServerTranslation(undefined, 'msp/opportunities');

  const eeTabs = managementAvailable
    ? [
        { id: 'meeting', label: t('opportunities.tabs.meeting', 'Meeting'), content: <OpportunityMeetingMode /> },
        { id: 'forecast', label: t('opportunities.tabs.forecast', 'Forecast'), content: <OpportunityForecastView /> },
      ]
    : [];

  return (
    <OpportunitiesHubHost
      initialItems={items}
      initialTotal={total}
      initialQueue={queue}
      initialClients={clients}
      draftingAvailable={draftingAvailable}
      eeTabs={eeTabs}
      userPreferenceKey={String((session.user as any).user_id ?? session.user.email ?? 'current-user')}
    />
  );
}

export const dynamic = 'force-dynamic';
