import { getInventoryDashboardData } from '@alga-psa/inventory/actions';
import type { InventoryDashboardData } from '@alga-psa/inventory/actions';
import { InventoryDashboard } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Inventory',
};

const EMPTY: InventoryDashboardData = {
  location_count: 0,
  van_count: 0,
  inventory_value: { by_location: [], grand_total: 0 },
  on_hand: { total_units: 0, serialized_units: 0 },
  on_order: { open_po_count: 0, on_order_value: 0, arriving_today: 0 },
  margin_mtd: { revenue: 0, cogs: 0, margin: 0, margin_pct: 0 },
  vendor_bills: { open_count: 0, open_total: 0, overdue_count: 0, overdue_total: 0 },
  this_week: { received: 0, deployed: 0, transfers: 0, rmas_opened: 0 },
  attention: [],
  receiving_queue: [],
  recent_movements: [],
};

export default async function InventoryDashboardPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/inventory', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let data: InventoryDashboardData = EMPTY;
  try {
    const result = await getInventoryDashboardData();
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      console.error('inventory dashboard: getInventoryDashboardData failed', getErrorMessage(result));
    } else {
      data = result;
    }
  } catch (err) {
    console.error('inventory dashboard: getInventoryDashboardData failed', err);
  }

  return <InventoryDashboard data={data} />;
}

export const dynamic = 'force-dynamic';
