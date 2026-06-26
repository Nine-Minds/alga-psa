import { listSalesOrders } from '@alga-psa/inventory/actions';
import { SalesOrdersManager } from '@alga-psa/inventory/components';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import type { ISalesOrder } from '@alga-psa/types';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Sales Orders',
};

export default async function SalesOrdersPage() {
  const boundary = await enforceServerProductRoute({ pathname: '/msp/inventory/sales-orders', scope: 'msp' });
  if (boundary) {
    return boundary;
  }

  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/msp/signin');
  }

  let initialSos: ISalesOrder[] = [];
  try {
    initialSos = await listSalesOrders({});
  } catch (error) {
    console.error('Failed to load sales orders:', error);
  }

  return <SalesOrdersManager initialSos={initialSos} />;
}

export const dynamic = 'force-dynamic';
