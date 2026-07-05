import { listTransfers, listStockLocations } from '@alga-psa/inventory/actions';
import { TransfersManager } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import type { IStockTransfer, IStockLocation } from '@alga-psa/types';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Transfers',
};

export default async function TransfersPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/inventory/transfers', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let initialTransfers: IStockTransfer[] = [];
  let initialLocations: IStockLocation[] = [];
  try {
    initialTransfers = await listTransfers({});
  } catch (error) {
    console.error('Failed to load transfers:', error);
  }
  try {
    initialLocations = await listStockLocations({ includeInactive: false });
  } catch (error) {
    console.error('Failed to load stock locations:', error);
  }

  return <TransfersManager initialTransfers={initialTransfers} initialLocations={initialLocations} />;
}

export const dynamic = 'force-dynamic';
