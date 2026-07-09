import { listCountSessions, listStockLocations } from '@alga-psa/inventory/actions';
import { CycleCountsManager } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { redirect } from 'next/navigation';
import type { IStockLocation } from '@alga-psa/types';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Cycle Counts',
};

export default async function CycleCountsPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/inventory/counts', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let initialSessions: any[] = [];
  try {
    const result = await listCountSessions();
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      console.error('Failed to load count sessions:', getErrorMessage(result));
    } else {
      initialSessions = result;
    }
  } catch (error) {
    console.error('Failed to load count sessions:', error);
  }

  let locations: IStockLocation[] = [];
  try {
    const result = await listStockLocations();
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      console.error('Failed to load stock locations:', getErrorMessage(result));
    } else {
      locations = result;
    }
  } catch (error) {
    console.error('Failed to load stock locations:', error);
  }

  return <CycleCountsManager initialSessions={initialSessions} locations={locations} />;
}

export const dynamic = 'force-dynamic';
