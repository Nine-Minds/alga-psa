import type { Knex } from 'knex';
import type {
  SalesOrderDocumentParty,
  SalesOrderViewModel,
  SalesOrderViewModelLineItem,
} from '@alga-psa/types';

import { fetchTenantParty } from './tenantPartyAdapter';

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toIsoOrNull = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const s = String(value).trim();
  return s.length > 0 ? s : null;
};

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

export interface ServiceNameRecord {
  service_name: string | null;
  sku: string | null;
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

/** Minimal shapes the assembler needs — a loaded sales_orders row and its lines. */
export interface SalesOrderRowForDocument {
  so_id: string;
  so_number: string;
  status?: string | null;
  order_date?: string | Date | null;
  expected_ship_date?: string | Date | null;
  client_po_number?: string | null;
  currency_code: string;
  notes?: string | null;
  client_id?: string | null;
}

export interface SalesOrderLineRowForDocument {
  so_line_id: string;
  service_id?: string | null;
  description?: string | null;
  quantity_ordered: number | string;
  quantity_fulfilled?: number | string | null;
  unit_price: number | string;
  fulfillment_type?: string | null;
}

/**
 * Pure assembly of a Sales Order render model from already-loaded data — no IO, so it is the
 * unit-testable core (line amounts, subtotal/total, name resolution). The IO (loading the order,
 * resolving parties and service names) lives in mapDbSalesOrderToViewModel.
 */
export function assembleSalesOrderViewModel(input: {
  so: SalesOrderRowForDocument;
  lines: SalesOrderLineRowForDocument[];
  servicesById: Map<string, ServiceNameRecord>;
  customer: SalesOrderDocumentParty | null;
  tenantParty: SalesOrderDocumentParty | null;
}): SalesOrderViewModel {
  const { so, lines, servicesById, customer, tenantParty } = input;

  const lineItems: SalesOrderViewModelLineItem[] = lines.map((line) => {
    const service = line.service_id ? servicesById.get(line.service_id) ?? null : null;
    const quantityOrdered = toFiniteNumber(line.quantity_ordered);
    const unitPrice = toFiniteNumber(line.unit_price);
    return {
      so_line_id: line.so_line_id,
      service_id: line.service_id ?? null,
      service_name: service?.service_name ?? null,
      service_sku: service?.sku ?? null,
      description: asTrimmedString(line.description) || service?.service_name || null,
      quantity_ordered: quantityOrdered,
      quantity_fulfilled: toFiniteNumber(line.quantity_fulfilled),
      unit_price: unitPrice,
      amount: quantityOrdered * unitPrice,
      fulfillment_type: line.fulfillment_type ?? null,
      is_drop_ship: line.fulfillment_type === 'drop_ship',
    };
  });

  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
  // Phase 1: SO lines carry tax_rate_id, not a stored tax amount; the final tax is computed on the
  // generated invoice. The order document reports the pre-tax total honestly rather than fabricating.
  const tax = 0;

  return {
    so_id: so.so_id,
    so_number: so.so_number,
    status: so.status ?? null,
    order_date: toIsoOrNull(so.order_date),
    expected_ship_date: toIsoOrNull(so.expected_ship_date),
    client_po_number: so.client_po_number ?? null,
    currency_code: so.currency_code,
    notes: so.notes ?? null,
    client_id: so.client_id ?? null,
    customer,
    tenantClient: tenantParty,
    line_items: lineItems,
    subtotal,
    tax,
    total: subtotal + tax,
  };
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
