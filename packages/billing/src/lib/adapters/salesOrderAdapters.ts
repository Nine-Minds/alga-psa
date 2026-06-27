import type { Knex } from 'knex';
import type { SalesOrderDocumentParty, SalesOrderViewModel } from '@alga-psa/types';

import { fetchTenantParty } from './tenantPartyAdapter';
import {
  asTrimmedString,
  assembleSalesOrderViewModel,
  type SalesOrderLineRowForDocument,
  type SalesOrderRowForDocument,
  type ServiceNameRecord,
} from './salesOrderViewModel';

// Re-export the pure assembler + its types so existing importers (and tests) keep working, while
// the knex-laden IO below stays out of any client bundle that only needs the pure model.
export {
  assembleSalesOrderViewModel,
  type SalesOrderLineRowForDocument,
  type SalesOrderRowForDocument,
  type ServiceNameRecord,
} from './salesOrderViewModel';

// LEVERAGE: pattern party-adapter — buildAddress / fetchCustomerParty mirror quoteAdapters' private
// helpers; converge into a shared party adapter when the generic document spine (Phase 2) lands.
const buildAddress = (record: Record<string, unknown> | null | undefined): string | null => {
  if (!record) return null;
  const parts = [
    record.address_line1,
    record.address_line2,
    record.address_line3,
    record.city,
    record.state_province,
    record.postal_code,
    record.country_name,
  ]
    .map(asTrimmedString)
    .filter((value, index, collection) => value.length > 0 && collection.indexOf(value) === index);
  return parts.length > 0 ? parts.join(', ') : null;
};

/** Resolve the customer party (name + preferred billing/default address) for a sales order. */
async function fetchCustomerParty(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId?: string | null,
): Promise<SalesOrderDocumentParty | null> {
  if (!clientId) return null;

  const client = await knexOrTrx('clients as c')
    .leftJoin('client_locations as cl', function joinLocations() {
      this.on('c.client_id', '=', 'cl.client_id')
        .andOn('c.tenant', '=', 'cl.tenant')
        .andOn(function preferredLocation() {
          this.on('cl.is_billing_address', '=', knexOrTrx.raw('true')).orOn(
            'cl.is_default',
            '=',
            knexOrTrx.raw('true'),
          );
        });
    })
    .select(
      'c.client_name',
      'c.billing_email',
      'cl.phone',
      'cl.email',
      'cl.address_line1',
      'cl.address_line2',
      'cl.address_line3',
      'cl.city',
      'cl.state_province',
      'cl.postal_code',
      'cl.country_name',
    )
    .where({ 'c.tenant': tenant, 'c.client_id': clientId })
    .orderByRaw('cl.is_billing_address DESC NULLS LAST, cl.is_default DESC NULLS LAST')
    .first<Record<string, unknown>>();

  if (!client) return null;

  return {
    name: asTrimmedString(client.client_name) || 'Customer',
    address: buildAddress(client),
    email: asTrimmedString(client.billing_email) || asTrimmedString(client.email) || null,
    phone: asTrimmedString(client.phone) || null,
    logo_url: null,
  };
}

/** Batch-resolve product/service names + SKUs for a set of service ids. */
async function fetchServiceNames(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  serviceIds: string[],
): Promise<Map<string, ServiceNameRecord>> {
  const map = new Map<string, ServiceNameRecord>();
  if (serviceIds.length === 0) return map;
  const rows = await knexOrTrx('service_catalog')
    .where({ tenant })
    .whereIn('service_id', serviceIds)
    .select('service_id', 'service_name', 'sku');
  for (const row of rows as Array<Record<string, unknown>>) {
    map.set(String(row.service_id), {
      service_name: (row.service_name as string | null) ?? null,
      sku: (row.sku as string | null) ?? null,
    });
  }
  return map;
}

/** Load a sales order + its lines and build the document render model. Null if not found. */
export async function mapDbSalesOrderToViewModel(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  soId: string,
): Promise<SalesOrderViewModel | null> {
  const so = await knexOrTrx('sales_orders')
    .where({ tenant, so_id: soId })
    .first<SalesOrderRowForDocument>();
  if (!so) return null;

  const lines = (await knexOrTrx('sales_order_lines')
    .where({ tenant, so_id: soId })
    .orderBy('created_at', 'asc')) as SalesOrderLineRowForDocument[];

  const serviceIds = Array.from(
    new Set(
      lines
        .map((line) => line.service_id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
    ),
  );

  const [customer, tenantParty, servicesById] = await Promise.all([
    fetchCustomerParty(knexOrTrx, tenant, so.client_id),
    fetchTenantParty(knexOrTrx, tenant),
    fetchServiceNames(knexOrTrx, tenant, serviceIds),
  ]);

  return assembleSalesOrderViewModel({ so, lines, servicesById, customer, tenantParty });
}
