import {
  getInventoryTenantCurrency,
  listKitSummaries,
  listSalesOrders,
  listStockLocations,
} from '@alga-psa/inventory/actions';
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
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { redirect } from 'next/navigation';
import type { IClient, ISalesOrder, IStockLocation } from '@alga-psa/types';
import type { SalesOrderServiceOption } from '@alga-psa/inventory/components';
import type { Metadata } from 'next';
import { enforceServerProductRoute } from '@/lib/serverProductRouteGuard';

export const metadata: Metadata = {
  title: 'Sales Orders',
};

interface SalesOrdersPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SalesOrdersPage({ searchParams }: SalesOrdersPageProps) {
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
    const query = await searchParams;
    const serviceId = query?.create === '1'
      ? undefined
      : typeof query?.service_id === 'string' ? query.service_id : undefined;
    const result = await listSalesOrders({ serviceId });
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

  // Products *and* services can be sold on a sales order (item_kind: 'any'). The picker and
  // price auto-fill live in the inventory client component, but the fetch belongs on the server
  // beside the other prop loads — inventory can't import billing's getServices directly.
  let services: SalesOrderServiceOption[] = [];
  try {
    const [paginated, kits] = await Promise.all([
      getServices(1, 999, { item_kind: 'any' }),
      listKitSummaries(),
    ]);
    if (isActionMessageError(kits) || isActionPermissionError(kits)) {
      console.error('Failed to load kits:', getErrorMessage(kits));
    }
    const kitList = isActionMessageError(kits) || isActionPermissionError(kits) ? [] : kits;
    const kitByServiceId = new Map(kitList.map((kit) => [kit.service_id, kit]));
    services = paginated.services.map((s) => ({
      service_id: s.service_id,
      service_name: s.service_name,
      sku: s.sku ?? null,
      default_rate: s.default_rate ?? null,
      is_kit: kitByServiceId.has(s.service_id),
      kit_pricing_mode: kitByServiceId.get(s.service_id)?.kit_pricing_mode ?? null,
      resolved_kit_price: kitByServiceId.get(s.service_id)?.computed_price ?? null,
      kit_currency: kitByServiceId.get(s.service_id)?.cost_currency ?? null,
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
      loadErrorMessage={loadErrorMessage}
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
