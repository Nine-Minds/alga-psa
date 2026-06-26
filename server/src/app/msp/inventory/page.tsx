import {
  inventoryValueReport,
  lowStockReport,
  openPosWidget,
  openSosWidget,
  deadUnitsOwedReport,
  expiringWarrantyReport,
} from '@alga-psa/inventory/actions';
import type {
  InventoryValueReport,
  OpenPosWidget,
  OpenSosWidget,
  ExpiringWarrantyRow,
  LowStockRow,
  DeadUnitOwedRow,
} from '@alga-psa/inventory/actions';
import { InventoryDashboard } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Inventory',
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

  let initialInventoryValue: InventoryValueReport = { by_location: [], grand_total: 0 };
  let initialLowStock: LowStockRow[] = [];
  let initialOpenPos: OpenPosWidget = { count: 0, purchase_orders: [] };
  let initialOpenSos: OpenSosWidget = { count: 0, sales_orders: [] };
  let initialDeadUnitsOwed: DeadUnitOwedRow[] = [];
  let initialExpiringWarranties: ExpiringWarrantyRow[] = [];

  const [valueRes, lowStockRes, posRes, sosRes, deadRes, warrantyRes] = await Promise.allSettled([
    inventoryValueReport(),
    lowStockReport(),
    openPosWidget(),
    openSosWidget(),
    deadUnitsOwedReport(),
    expiringWarrantyReport(30),
  ]);

  if (valueRes.status === 'fulfilled') initialInventoryValue = valueRes.value;
  else console.error('inventory dashboard: inventoryValueReport failed', valueRes.reason);
  if (lowStockRes.status === 'fulfilled') initialLowStock = lowStockRes.value;
  else console.error('inventory dashboard: lowStockReport failed', lowStockRes.reason);
  if (posRes.status === 'fulfilled') initialOpenPos = posRes.value;
  else console.error('inventory dashboard: openPosWidget failed', posRes.reason);
  if (sosRes.status === 'fulfilled') initialOpenSos = sosRes.value;
  else console.error('inventory dashboard: openSosWidget failed', sosRes.reason);
  if (deadRes.status === 'fulfilled') initialDeadUnitsOwed = deadRes.value;
  else console.error('inventory dashboard: deadUnitsOwedReport failed', deadRes.reason);
  if (warrantyRes.status === 'fulfilled') initialExpiringWarranties = warrantyRes.value;
  else console.error('inventory dashboard: expiringWarrantyReport failed', warrantyRes.reason);

  return (
    <InventoryDashboard
      initialInventoryValue={initialInventoryValue}
      initialLowStock={initialLowStock}
      initialOpenPos={initialOpenPos}
      initialOpenSos={initialOpenSos}
      initialDeadUnitsOwed={initialDeadUnitsOwed}
      initialExpiringWarranties={initialExpiringWarranties}
    />
  );
}

export const dynamic = 'force-dynamic';
