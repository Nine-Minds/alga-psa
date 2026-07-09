import { listPurchaseOrders } from '@alga-psa/inventory/actions';
import type { PurchaseOrderListRow } from '@alga-psa/inventory/actions';
import { PurchaseOrdersManager } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { redirect } from 'next/navigation';
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

  let initialPos: PurchaseOrderListRow[] = [];
  let loadError = false;
  let loadErrorMessage: string | undefined;
  try {
    const result = await listPurchaseOrders({});
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      loadError = true;
      loadErrorMessage = getErrorMessage(result);
    } else {
      initialPos = result;
    }
  } catch (error) {
    console.error('Failed to load purchase orders:', error);
    loadError = true;
  }

  return <PurchaseOrdersManager initialPos={initialPos} loadError={loadError} loadErrorMessage={loadErrorMessage} />;
}

export const dynamic = 'force-dynamic';
