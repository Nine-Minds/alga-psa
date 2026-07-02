import { listSalesOrders, listStockLocations } from '@alga-psa/inventory/actions';
import { SalesOrdersManager } from '@alga-psa/inventory/components';
// Billing owns SO invoicing (billing → inventory dependency direction); the server
// action references are passed down to the client component as props (F008).
import {
  confirmDropShipAndInvoice,
  fulfillAndInvoiceSoLine,
  generateInvoiceForSalesOrder,
} from '@alga-psa/billing/actions';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import type { ISalesOrder, IStockLocation } from '@alga-psa/types';
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

  let locations: IStockLocation[] = [];
  try {
    locations = await listStockLocations();
  } catch (error) {
    console.error('Failed to load stock locations:', error);
  }

  return (
    <SalesOrdersManager
      initialSos={initialSos}
      locations={locations}
      fulfillAndInvoice={fulfillAndInvoiceSoLine}
      generateInvoice={generateInvoiceForSalesOrder}
      confirmDropShip={confirmDropShipAndInvoice}
    />
  );
}

export const dynamic = 'force-dynamic';
