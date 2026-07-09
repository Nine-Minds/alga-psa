import { getInventoryTenantCurrency, listSalesOrders, listStockLocations } from '@alga-psa/inventory/actions';
import { SalesOrdersManager } from '@alga-psa/inventory/components';
// Billing owns SO invoicing (billing → inventory dependency direction); the server
// action references are passed down to the client component as props (F008).
import {
  confirmDropShipAndInvoice,
  fulfillAndInvoiceSoLine,
  generateInvoiceForSalesOrder,
  getServices,
} from '@alga-psa/billing/actions';
import { getAllClients } from '@alga-psa/clients/actions';
import { getSession } from '@alga-psa/auth';
import { redirect } from 'next/navigation';
import type { IClient, ISalesOrder, IStockLocation } from '@alga-psa/types';
import type { SalesOrderServiceOption } from '@alga-psa/inventory/components';
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

  let clients: IClient[] = [];
  try {
    clients = await getAllClients();
  } catch (error) {
    console.error('Failed to load clients:', error);
  }

  // Products *and* services can be sold on a sales order (item_kind: 'any'). The picker and
  // price auto-fill live in the inventory client component, but the fetch belongs on the server
  // beside the other prop loads — inventory can't import billing's getServices directly.
  let services: SalesOrderServiceOption[] = [];
  try {
    const paginated = await getServices(1, 999, { item_kind: 'any' });
    services = paginated.services.map((s) => ({
      service_id: s.service_id,
      service_name: s.service_name,
      sku: s.sku ?? null,
      default_rate: s.default_rate ?? null,
    }));
  } catch (error) {
    console.error('Failed to load services:', error);
  }

  let defaultCurrencyCode = 'USD';
  try {
    defaultCurrencyCode = await getInventoryTenantCurrency();
  } catch (error) {
    console.error('Failed to load inventory default currency:', error);
  }

  return (
    <SalesOrdersManager
      initialSos={initialSos}
      locations={locations}
      clients={clients}
      services={services}
      fulfillAndInvoice={fulfillAndInvoiceSoLine}
      generateInvoice={generateInvoiceForSalesOrder}
      confirmDropShip={confirmDropShipAndInvoice}
      defaultCurrencyCode={defaultCurrencyCode}
    />
  );
}

export const dynamic = 'force-dynamic';
