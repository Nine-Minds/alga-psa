import { listStockLocations } from '@alga-psa/inventory/actions';
import { StockLocationsManager } from '@alga-psa/inventory/components';
import { getAllUsersBasic } from '@alga-psa/user-composition/actions';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import type { IStockLocation, IUser } from '@alga-psa/types';
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
    // Load inactive too; the client hides them behind a "Show inactive" toggle so a deactivated
    // location stays reachable (and reactivatable) instead of vanishing. includeStock attaches the
    // on-hand occupancy so the list shows what each location holds (and gates deactivation).
    initialLocations = await listStockLocations({ includeInactive: true, includeStock: true });
  } catch (error) {
    console.error('Failed to load stock locations:', error);
    loadError = true;
  }

  // Active internal users (engineers) for the "Assigned to" picker — a location can belong to a
  // person (whose vehicle/shelf it is). Best-effort: a failure here just leaves the picker empty.
  let users: IUser[] = [];
  try {
    users = await getAllUsersBasic(false, 'internal');
  } catch (error) {
    console.error('Failed to load users for stock locations:', error);
  }

  return (
    <StockLocationsManager initialLocations={initialLocations} loadError={loadError} users={users} />
  );
}

export const dynamic = 'force-dynamic';
