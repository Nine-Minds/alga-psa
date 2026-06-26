import { listPurchaseOrders } from '@alga-psa/inventory/actions';
import { PurchaseOrdersManager } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import type { IPurchaseOrder } from '@alga-psa/types';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Purchase Orders',
};

export default async function PurchaseOrdersPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/inventory/purchase-orders', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let initialPos: IPurchaseOrder[] = [];
  try {
    initialPos = await listPurchaseOrders({});
  } catch (error) {
    console.error('Failed to load purchase orders:', error);
  }

  return <PurchaseOrdersManager initialPos={initialPos} />;
}

export const dynamic = 'force-dynamic';
