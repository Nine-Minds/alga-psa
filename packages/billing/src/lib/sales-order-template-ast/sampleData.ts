import type { SalesOrderViewModel } from '@alga-psa/types';

import { assembleSalesOrderViewModel } from '../adapters/salesOrderViewModel';

/**
 * A representative Sales Order render model for designer preview — so authors see a realistic
 * confirmation while editing the template, without loading a real order.
 */
export function buildSampleSalesOrderViewModel(): SalesOrderViewModel {
  return assembleSalesOrderViewModel({
    so: {
      so_id: 'sample-so',
      so_number: 'SO-00042',
      status: 'confirmed',
      order_date: '2026-06-26',
      expected_ship_date: '2026-07-01',
      client_po_number: 'PO-ACME-9',
      currency_code: 'USD',
      notes: 'Deliver to the loading dock; call on arrival.',
      client_id: 'sample-client',
    },
    lines: [
      { so_line_id: 's1', service_id: 'svc-switch', quantity_ordered: 10, quantity_fulfilled: 10, unit_price: 38000, fulfillment_type: 'from_stock' },
      { so_line_id: 's2', service_id: 'svc-laptop', quantity_ordered: 5, quantity_fulfilled: 3, unit_price: 124000, fulfillment_type: 'drop_ship' },
      { so_line_id: 's3', service_id: 'svc-cable', quantity_ordered: 50, quantity_fulfilled: 0, unit_price: 450, fulfillment_type: 'from_stock' },
    ],
    servicesById: new Map([
      ['svc-switch', { service_name: 'UniFi Switch 24 PoE', sku: 'UBNT-US24P' }],
      ['svc-laptop', { service_name: 'Dell Latitude 5440', sku: 'DELL-L5440' }],
      ['svc-cable', { service_name: 'Cat6 Patch 1ft', sku: 'CAT6-1FT' }],
    ]),
    customer: { name: 'Acme Corp', address: '123 Main St, Denver, CO 80202', email: null, phone: null, logo_url: null },
    tenantParty: { name: 'Northwind MSP', address: '400 SW Main St, Portland, OR 97204', email: null, phone: null, logo_url: null },
  });
}
