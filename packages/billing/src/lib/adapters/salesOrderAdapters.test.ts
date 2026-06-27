import { describe, expect, it } from 'vitest';

import {
  assembleSalesOrderViewModel,
  type SalesOrderLineRowForDocument,
  type SalesOrderRowForDocument,
  type ServiceNameRecord,
} from './salesOrderAdapters';

const so: SalesOrderRowForDocument = {
  so_id: 'so-1',
  so_number: 'SO-00042',
  status: 'confirmed',
  order_date: '2026-06-26',
  expected_ship_date: '2026-07-01',
  client_po_number: 'PO-ACME-9',
  currency_code: 'USD',
  notes: 'Leave at the dock.',
  client_id: 'client-1',
};

const lines: SalesOrderLineRowForDocument[] = [
  { so_line_id: 'l1', service_id: 'svc-switch', quantity_ordered: 10, quantity_fulfilled: 10, unit_price: 38000 },
  { so_line_id: 'l2', service_id: 'svc-laptop', quantity_ordered: 5, quantity_fulfilled: 3, unit_price: 124000 },
];

const servicesById = new Map<string, ServiceNameRecord>([
  ['svc-switch', { service_name: 'UniFi Switch 24 PoE', sku: 'UBNT-US24P' }],
  ['svc-laptop', { service_name: 'Dell Latitude 5440', sku: 'DELL-L5440' }],
]);

const customer = { name: 'Acme Corp', address: '123 Main St', email: null, phone: null, logo_url: null };
const tenantParty = { name: 'Northwind MSP', address: '400 SW Main', email: null, phone: null, logo_url: null };

describe('assembleSalesOrderViewModel', () => {
  it('computes per-line amounts, subtotal, and total from ordered quantity × unit price', () => {
    const vm = assembleSalesOrderViewModel({ so, lines, servicesById, customer, tenantParty });

    expect(vm.line_items.map((i) => i.amount)).toEqual([380000, 620000]);
    expect(vm.subtotal).toBe(1000000);
    // Phase 1: no stored tax on SO lines — pre-tax total reported honestly.
    expect(vm.tax).toBe(0);
    expect(vm.total).toBe(1000000);
  });

  it('resolves product name + SKU for each line from the services map', () => {
    const vm = assembleSalesOrderViewModel({ so, lines, servicesById, customer, tenantParty });

    expect(vm.line_items[0].service_name).toBe('UniFi Switch 24 PoE');
    expect(vm.line_items[0].service_sku).toBe('UBNT-US24P');
    expect(vm.line_items[1].service_name).toBe('Dell Latitude 5440');
    // description falls back to the product name when the line has none
    expect(vm.line_items[0].description).toBe('UniFi Switch 24 PoE');
  });

  it('carries header fields, parties, and fulfillment progress through', () => {
    const vm = assembleSalesOrderViewModel({ so, lines, servicesById, customer, tenantParty });

    expect(vm.so_number).toBe('SO-00042');
    expect(vm.client_po_number).toBe('PO-ACME-9');
    expect(vm.customer?.name).toBe('Acme Corp');
    expect(vm.tenant?.name).toBe('Northwind MSP');
    expect(vm.line_items[1].quantity_fulfilled).toBe(3);
  });

  it('handles a sales order with no lines without throwing (zero totals)', () => {
    const vm = assembleSalesOrderViewModel({
      so,
      lines: [],
      servicesById: new Map(),
      customer: null,
      tenantParty: null,
    });

    expect(vm.line_items).toEqual([]);
    expect(vm.subtotal).toBe(0);
    expect(vm.total).toBe(0);
    expect(vm.customer).toBeNull();
  });

  it('leaves name fields null when a line references an unknown service', () => {
    const vm = assembleSalesOrderViewModel({
      so,
      lines: [{ so_line_id: 'l9', service_id: 'svc-missing', quantity_ordered: 2, unit_price: 500 }],
      servicesById,
      customer,
      tenantParty,
    });

    expect(vm.line_items[0].service_name).toBeNull();
    expect(vm.line_items[0].amount).toBe(1000);
  });
});
