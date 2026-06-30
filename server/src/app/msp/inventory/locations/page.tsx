import { listStockLocations } from '@alga-psa/inventory/actions';
import { StockLocationsManager } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import type { IStockLocation } from '@alga-psa/types';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Stock Locations',
};

export default async function StockLocationsPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/inventory/locations', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let initialLocations: IStockLocation[] = [];
  let loadError = false;
  try {
    initialLocations = await listStockLocations({ includeInactive: false });
  } catch (error) {
    console.error('Failed to load stock locations:', error);
    loadError = true;
  }

  return <StockLocationsManager initialLocations={initialLocations} loadError={loadError} />;
}

export const dynamic = 'force-dynamic';
