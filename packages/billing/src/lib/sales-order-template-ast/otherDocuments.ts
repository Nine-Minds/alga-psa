import type { TemplateAst } from '@alga-psa/types';
import { DEFAULT_INVOICE_PRINT_SETTINGS, TEMPLATE_AST_VERSION } from '@alga-psa/types';

import { buildSalesOrderTemplateBindings } from './bindings';

const cloneAst = (ast: TemplateAst): TemplateAst => JSON.parse(JSON.stringify(ast)) as TemplateAst;

/**
 * Packing Slip — goes in the box with the shipment: ship-to + items with ordered/shipped quantities
 * and a drop-ship flag, NO prices. Renders from the same SalesOrderViewModel as the confirmation
 * (so the registry reuses the SO bindings + sample); only the layout differs.
 */
const buildStandardPackingSlipAst = (): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  metadata: { templateName: 'Standard Packing Slip', printSettings: DEFAULT_INVOICE_PRINT_SETTINGS },
  bindings: buildSalesOrderTemplateBindings(),
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'header-top',
        type: 'stack',
        direction: 'row',
        style: { inline: { justifyContent: 'space-between', alignItems: 'flex-start', gap: '24px', margin: '0 0 20px 0' } },
        children: [
          {
            id: 'issuer-brand',
            type: 'stack',
            direction: 'column',
            style: { inline: { gap: '6px' } },
            children: [
              { id: 'issuer-logo', type: 'image', src: { type: 'binding', bindingId: 'tenantLogo' }, alt: { type: 'literal', value: 'logo' }, style: { inline: { width: '180px', maxHeight: '72px', margin: '0 0 6px 0' } } },
              { id: 'issuer-name', type: 'text', content: { type: 'binding', bindingId: 'tenantName' }, style: { inline: { fontSize: '18px', fontWeight: 700, lineHeight: 1.2 } } },
              { id: 'issuer-address', type: 'text', content: { type: 'binding', bindingId: 'tenantAddress' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
            ],
          },
          {
            id: 'meta-card',
            type: 'stack',
            direction: 'column',
            style: { inline: { minWidth: '260px', border: '1px solid #d1d5db', borderRadius: '10px', padding: '14px 16px', backgroundColor: '#f9fafb', gap: '6px' } },
            children: [
              { id: 'title', type: 'text', content: { type: 'literal', value: 'PACKING SLIP' }, style: { inline: { fontSize: '20px', fontWeight: 700, margin: '0 0 4px 0' } } },
              { id: 'order-number', type: 'field', label: 'Order #', binding: { bindingId: 'orderNumber' }, style: { inline: { justifyContent: 'space-between' } } },
              { id: 'expected-ship', type: 'field', label: 'Ship Date', binding: { bindingId: 'expectedShipDate' }, format: 'date', emptyValue: '-', style: { inline: { justifyContent: 'space-between' } } },
              { id: 'po-number', type: 'field', label: 'Your PO #', binding: { bindingId: 'poNumber' }, emptyValue: '-', style: { inline: { justifyContent: 'space-between' } } },
            ],
          },
        ],
      },
      { id: 'divider', type: 'divider', style: { inline: { margin: '0 0 20px 0' } } },
      {
        id: 'ship-to-card',
        type: 'stack',
        direction: 'column',
        style: { inline: { gap: '4px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px', margin: '0 0 20px 0', maxWidth: '340px' } },
        children: [
          { id: 'ship-to-label', type: 'text', content: { type: 'literal', value: 'Ship To' }, style: { inline: { color: '#6b7280', fontSize: '12px', fontWeight: 700 } } },
          { id: 'customer-name', type: 'text', content: { type: 'binding', bindingId: 'customerName' }, style: { inline: { fontSize: '15px', fontWeight: 600 } } },
          { id: 'customer-address', type: 'text', content: { type: 'binding', bindingId: 'customerAddress' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
        ],
      },
      {
        id: 'line-items',
        type: 'dynamic-table',
        style: { inline: { margin: '0 0 16px 0', border: '1px solid #e5e7eb', borderRadius: '10px' } },
        repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' },
        emptyStateText: 'No items on this order',
        columns: [
          { id: 'product', header: 'Product', value: { type: 'path', path: 'description' }, style: { inline: { width: '40%' } } },
          { id: 'sku', header: 'SKU', value: { type: 'path', path: 'service_sku' }, style: { inline: { width: '20%' } } },
          { id: 'fulfillment', header: 'Source', value: { type: 'path', path: 'fulfillment_type' }, style: { inline: { width: '16%' } } },
          { id: 'ordered', header: 'Ordered', value: { type: 'path', path: 'quantity_ordered' }, format: 'number', style: { inline: { textAlign: 'right', width: '12%' } } },
          { id: 'shipped', header: 'Shipped', value: { type: 'path', path: 'quantity_fulfilled' }, format: 'number', style: { inline: { textAlign: 'right', width: '12%' } } },
        ],
      },
      { id: 'notes-section', type: 'section', title: 'Notes', children: [
        { id: 'notes-copy', type: 'text', content: { type: 'binding', bindingId: 'notes' }, style: { inline: { color: '#374151', lineHeight: 1.5 } } },
      ] },
    ],
  },
});

/**
 * Pick List — internal warehouse document: items + quantities to pull, with a check column. No
 * customer, no prices. Renders from the SalesOrderViewModel.
 */
const buildStandardPickListAst = (): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  metadata: { templateName: 'Standard Pick List', printSettings: DEFAULT_INVOICE_PRINT_SETTINGS },
  bindings: buildSalesOrderTemplateBindings(),
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'header',
        type: 'stack',
        direction: 'row',
        style: { inline: { justifyContent: 'space-between', alignItems: 'baseline', margin: '0 0 8px 0' } },
        children: [
          { id: 'title', type: 'text', content: { type: 'literal', value: 'PICK LIST' }, style: { inline: { fontSize: '22px', fontWeight: 700 } } },
          { id: 'order-number', type: 'field', label: 'Order #', binding: { bindingId: 'orderNumber' }, style: { inline: { justifyContent: 'flex-end', gap: '6px' } } },
        ],
      },
      { id: 'divider', type: 'divider', style: { inline: { margin: '0 0 16px 0' } } },
      {
        id: 'line-items',
        type: 'dynamic-table',
        style: { inline: { margin: '0 0 16px 0', border: '1px solid #e5e7eb', borderRadius: '10px' } },
        repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' },
        emptyStateText: 'No items to pick',
        columns: [
          { id: 'check', header: 'Picked', value: { type: 'literal', value: '☐' }, style: { inline: { width: '8%', textAlign: 'center' } } },
          { id: 'qty', header: 'Qty', value: { type: 'path', path: 'quantity_ordered' }, format: 'number', style: { inline: { width: '10%', textAlign: 'right' } } },
          { id: 'product', header: 'Product', value: { type: 'path', path: 'description' }, style: { inline: { width: '52%' } } },
          { id: 'sku', header: 'SKU', value: { type: 'path', path: 'service_sku' }, style: { inline: { width: '20%' } } },
        ],
      },
      { id: 'picker', type: 'text', content: { type: 'literal', value: 'Picked by: ____________________     Date: ____________' }, style: { inline: { color: '#374151', margin: '24px 0 0 0' } } },
    ],
  },
});

export const STANDARD_PACKING_SLIP_TEMPLATE_ASTS: Record<string, TemplateAst> = {
  'standard-packing-slip': buildStandardPackingSlipAst(),
};
export const STANDARD_PICK_LIST_TEMPLATE_ASTS: Record<string, TemplateAst> = {
  'standard-pick-list': buildStandardPickListAst(),
};

export const STANDARD_PACKING_SLIP_CODE = 'standard-packing-slip';
export const STANDARD_PICK_LIST_CODE = 'standard-pick-list';

export const getStandardPackingSlipTemplateAstByCode = (code: string): TemplateAst | null => {
  const ast = STANDARD_PACKING_SLIP_TEMPLATE_ASTS[code];
  return ast ? cloneAst(ast) : null;
};
export const getStandardPickListTemplateAstByCode = (code: string): TemplateAst | null => {
  const ast = STANDARD_PICK_LIST_TEMPLATE_ASTS[code];
  return ast ? cloneAst(ast) : null;
};
