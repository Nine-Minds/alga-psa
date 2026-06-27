import type {
  SalesOrderDocumentParty,
  SalesOrderViewModel,
  SalesOrderViewModelLineItem,
} from '@alga-psa/types';

/**
 * Pure Sales Order render-model assembly — NO knex / @alga-psa/db imports, so it is safe to pull
 * into the client bundle (the document-type registry's sample data flows through here). The IO
 * loader (mapDbSalesOrderToViewModel) lives in salesOrderAdapters and feeds this.
 */

export const asTrimmedString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

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

export interface ServiceNameRecord {
  service_name: string | null;
  sku: string | null;
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
 * unit-testable core (line amounts, subtotal/total, name resolution).
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
