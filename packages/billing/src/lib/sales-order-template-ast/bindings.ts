import type { TemplateAst } from '@alga-psa/types';

type SalesOrderTemplateBindings = NonNullable<TemplateAst['bindings']>;
type SalesOrderTemplateValueBindings = NonNullable<SalesOrderTemplateBindings['values']>;
type SalesOrderTemplateCollectionBindings = NonNullable<SalesOrderTemplateBindings['collections']>;

/**
 * The value bindings a Sales Order document template can address. Paths resolve against
 * SalesOrderViewModel (built by mapDbSalesOrderToViewModel). These are also what the designer's
 * binding catalog exposes once Sales Order is a registered document type (Phase 2).
 */
export const SALES_ORDER_TEMPLATE_VALUE_BINDINGS: SalesOrderTemplateValueBindings = {
  orderNumber: { id: 'orderNumber', kind: 'value', path: 'so_number' },
  orderDate: { id: 'orderDate', kind: 'value', path: 'order_date' },
  expectedShipDate: { id: 'expectedShipDate', kind: 'value', path: 'expected_ship_date', fallback: '' },
  status: { id: 'status', kind: 'value', path: 'status', fallback: '' },
  poNumber: { id: 'poNumber', kind: 'value', path: 'client_po_number', fallback: '' },
  currencyCode: { id: 'currencyCode', kind: 'value', path: 'currency_code', fallback: 'USD' },
  notes: { id: 'notes', kind: 'value', path: 'notes', fallback: '' },
  customerName: { id: 'customerName', kind: 'value', path: 'customer.name', fallback: 'Customer' },
  customerAddress: { id: 'customerAddress', kind: 'value', path: 'customer.address', fallback: '' },
  tenantName: { id: 'tenantName', kind: 'value', path: 'tenantClient.name', fallback: 'Your Company' },
  tenantAddress: { id: 'tenantAddress', kind: 'value', path: 'tenantClient.address', fallback: '' },
  tenantLogo: { id: 'tenantLogo', kind: 'value', path: 'tenantClient.logo_url' },
  subtotal: { id: 'subtotal', kind: 'value', path: 'subtotal' },
  tax: { id: 'tax', kind: 'value', path: 'tax' },
  total: { id: 'total', kind: 'value', path: 'total' },
};

export const SALES_ORDER_TEMPLATE_COLLECTION_BINDINGS: SalesOrderTemplateCollectionBindings = {
  lineItems: { id: 'lineItems', kind: 'collection', path: 'line_items' },
};

export const buildSalesOrderTemplateBindings = (): SalesOrderTemplateBindings => ({
  values: {
    ...SALES_ORDER_TEMPLATE_VALUE_BINDINGS,
  },
  collections: {
    ...SALES_ORDER_TEMPLATE_COLLECTION_BINDINGS,
  },
});
