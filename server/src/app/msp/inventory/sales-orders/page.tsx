import { listSalesOrders, listStockLocations } from '@alga-psa/inventory/actions';
import { SalesOrdersManager } from '@alga-psa/inventory/components';
// Billing owns SO invoicing (billing → inventory dependency direction); the server
// action references are passed down to the client component as props (F008).
import {
  confirmDropShipAndInvoice,
  fulfillAndInvoiceSoLine,
  generateInvoiceForSalesOrder,
} from '@alga-psa/billing/actions';
import { getAllClients } from '@alga-psa/clients/actions';
import { getSession } from '@alga-psa/auth';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { redirect } from 'next/navigation';
import type { IClient, ISalesOrder, IStockLocation } from '@alga-psa/types';
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
  let loadErrorMessage: string | undefined;
  try {
    const result = await listSalesOrders({});
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      loadErrorMessage = getErrorMessage(result);
    } else {
      initialSos = result;
    }
  } catch (error) {
    console.error('Failed to load sales orders:', error);
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

  let clients: IClient[] = [];
  try {
    clients = await getAllClients();
  } catch (error) {
    console.error('Failed to load clients:', error);
  }

  return (
    <SalesOrdersManager
      initialSos={initialSos}
      loadErrorMessage={loadErrorMessage}
      locations={locations}
      clients={clients}
      fulfillAndInvoice={fulfillAndInvoiceSoLine}
      generateInvoice={generateInvoiceForSalesOrder}
      confirmDropShip={confirmDropShipAndInvoice}
    />
  );
}

export const dynamic = 'force-dynamic';
