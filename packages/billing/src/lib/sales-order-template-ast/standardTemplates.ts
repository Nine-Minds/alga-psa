import type { TemplateAst } from '@alga-psa/types';
import { DEFAULT_INVOICE_PRINT_SETTINGS, TEMPLATE_AST_VERSION } from '@alga-psa/types';

import { buildSalesOrderTemplateBindings } from './bindings';

const cloneAst = (ast: TemplateAst): TemplateAst => JSON.parse(JSON.stringify(ast)) as TemplateAst;

/**
 * Standard Sales Order Confirmation — a clean, branded order-acknowledgement: issuer logo +
 * order meta card, From / Ship To party blocks, the ordered line items, and a totals card.
 * Phase 1 reports the pre-tax total honestly (final tax is applied on the generated invoice).
 */
const buildStandardSalesOrderConfirmationAst = (): TemplateAst => ({
  kind: 'invoice-template-ast',
  version: TEMPLATE_AST_VERSION,
  metadata: {
    templateName: 'Standard Sales Order Confirmation',
    printSettings: DEFAULT_INVOICE_PRINT_SETTINGS,
  },
  bindings: buildSalesOrderTemplateBindings(),
  layout: {
    id: 'root',
    type: 'document',
    children: [
      // ── Header: logo + order meta card ────────────────────────────
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
              {
                id: 'issuer-logo',
                type: 'image',
                src: { type: 'binding', bindingId: 'tenantLogo' },
                alt: { type: 'template', template: '{{name}} logo', args: { name: { type: 'binding', bindingId: 'tenantName' } } },
                style: { inline: { width: '180px', maxHeight: '72px', margin: '0 0 6px 0' } },
              },
              { id: 'issuer-name', type: 'text', content: { type: 'binding', bindingId: 'tenantName' }, style: { inline: { fontSize: '18px', fontWeight: 700, lineHeight: 1.2 } } },
              { id: 'issuer-address', type: 'text', content: { type: 'binding', bindingId: 'tenantAddress' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
            ],
          },
          {
            id: 'order-meta-card',
            type: 'stack',
            direction: 'column',
            style: { inline: { minWidth: '280px', border: '1px solid #d1d5db', borderRadius: '10px', padding: '14px 16px', backgroundColor: '#f9fafb', gap: '6px' } },
            children: [
              { id: 'order-title', type: 'text', content: { type: 'literal', value: 'ORDER CONFIRMATION' }, style: { inline: { fontSize: '20px', fontWeight: 700, margin: '0 0 4px 0', lineHeight: 1.1 } } },
              { id: 'order-number', type: 'field', label: 'Order #', binding: { bindingId: 'orderNumber' }, style: { inline: { justifyContent: 'space-between' } } },
              { id: 'order-date', type: 'field', label: 'Order Date', binding: { bindingId: 'orderDate' }, format: 'date', style: { inline: { justifyContent: 'space-between' } } },
              { id: 'expected-ship', type: 'field', label: 'Expected Ship', binding: { bindingId: 'expectedShipDate' }, format: 'date', emptyValue: '-', style: { inline: { justifyContent: 'space-between' } } },
              { id: 'po-number', type: 'field', label: 'Your PO #', binding: { bindingId: 'poNumber' }, emptyValue: '-', style: { inline: { justifyContent: 'space-between' } } },
            ],
          },
        ],
      },
      // ── Divider ────────────────────────────────────────────────────
      { id: 'header-divider', type: 'divider', style: { inline: { margin: '0 0 20px 0' } } },
      // ── Party blocks: From / Ship To ──────────────────────────────
      {
        id: 'party-blocks',
        type: 'stack',
        direction: 'row',
        style: { inline: { gap: '24px', margin: '0 0 20px 0' } },
        children: [
          {
            id: 'from-card',
            type: 'stack',
            direction: 'column',
            style: { inline: { flex: '1', gap: '4px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px' } },
            children: [
              { id: 'from-label', type: 'text', content: { type: 'literal', value: 'From' }, style: { inline: { color: '#6b7280', fontSize: '12px', fontWeight: 700, margin: '0 0 2px 0' } } },
              { id: 'from-name', type: 'text', content: { type: 'binding', bindingId: 'tenantName' }, style: { inline: { fontSize: '15px', fontWeight: 600, lineHeight: 1.3 } } },
              { id: 'from-address', type: 'text', content: { type: 'binding', bindingId: 'tenantAddress' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
            ],
          },
          {
            id: 'ship-to-card',
            type: 'stack',
            direction: 'column',
            style: { inline: { flex: '1', gap: '4px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px' } },
            children: [
              { id: 'ship-to-label', type: 'text', content: { type: 'literal', value: 'Ship To' }, style: { inline: { color: '#6b7280', fontSize: '12px', fontWeight: 700, margin: '0 0 2px 0' } } },
              { id: 'customer-name', type: 'text', content: { type: 'binding', bindingId: 'customerName' }, style: { inline: { fontSize: '15px', fontWeight: 600, lineHeight: 1.3 } } },
              { id: 'customer-address', type: 'text', content: { type: 'binding', bindingId: 'customerAddress' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
            ],
          },
        ],
      },
      // ── Line items table ──────────────────────────────────────────
      {
        id: 'line-items',
        type: 'dynamic-table',
        style: { inline: { margin: '0 0 16px 0', border: '1px solid #e5e7eb', borderRadius: '10px' } },
        repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' },
        emptyStateText: 'No items on this order',
        columns: [
          { id: 'product', header: 'Product', value: { type: 'path', path: 'description' }, style: { inline: { width: '46%' } } },
          { id: 'sku', header: 'SKU', value: { type: 'path', path: 'service_sku' }, style: { inline: { width: '18%' } } },
          { id: 'quantity', header: 'Qty', value: { type: 'path', path: 'quantity_ordered' }, format: 'number', style: { inline: { textAlign: 'right', width: '10%' } } },
          { id: 'unit-price', header: 'Unit Price', value: { type: 'path', path: 'unit_price' }, format: 'currency', style: { inline: { textAlign: 'right', width: '13%' } } },
          { id: 'amount', header: 'Amount', value: { type: 'path', path: 'amount' }, format: 'currency', style: { inline: { textAlign: 'right', width: '13%' } } },
        ],
      },
      // ── Totals (right-aligned card) ───────────────────────────────
      {
        id: 'totals-wrap',
        type: 'stack',
        direction: 'row',
        style: { inline: { justifyContent: 'flex-end', margin: '0 0 8px 0' } },
        children: [
          {
            id: 'totals',
            type: 'totals',
            style: { inline: { width: '300px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px 12px', backgroundColor: '#f9fafb' } },
            sourceBinding: { bindingId: 'lineItems' },
            rows: [
              { id: 'subtotal', label: 'Subtotal', value: { type: 'binding', bindingId: 'subtotal' }, format: 'currency' },
              { id: 'order-total', label: 'Order Total', value: { type: 'binding', bindingId: 'total' }, format: 'currency', emphasize: true },
            ],
          },
        ],
      },
      // ── Tax note ──────────────────────────────────────────────────
      {
        id: 'tax-note',
        type: 'text',
        content: { type: 'literal', value: 'Totals shown are pre-tax. Applicable tax is calculated on your invoice.' },
        style: { inline: { color: '#6b7280', fontSize: '12px', textAlign: 'right', margin: '0 0 20px 0' } },
      },
      // ── Notes ─────────────────────────────────────────────────────
      {
        id: 'notes-section',
        type: 'section',
        title: 'Notes',
        children: [
          { id: 'notes-copy', type: 'text', content: { type: 'binding', bindingId: 'notes' }, style: { inline: { color: '#374151', lineHeight: 1.5 } } },
        ],
      },
      // ── Footer ────────────────────────────────────────────────────
      {
        id: 'footer-thanks',
        type: 'text',
        content: { type: 'literal', value: 'Thank you for your order.' },
        style: { inline: { color: '#374151', fontSize: '13px', margin: '24px 0 0 0' } },
      },
    ],
  },
});

/**
 * Detailed Sales Order Confirmation — the standard confirmation plus a per-line Fulfillment column
 * (from stock vs drop-ship) and an ordered-vs-fulfilled split. Built by augmenting the confirmation
 * so the two stay in sync.
 */
const buildStandardSalesOrderDetailedAst = (): TemplateAst => {
  const ast = buildStandardSalesOrderConfirmationAst();
  ast.metadata = { ...ast.metadata, templateName: 'Detailed Sales Order Confirmation' };

  const lineItems = (ast.layout.children as any[] | undefined)?.find((c) => c?.id === 'line-items');
  if (lineItems) {
    lineItems.columns = [
      { id: 'product', header: 'Product', value: { type: 'path', path: 'description' }, style: { inline: { width: '34%' } } },
      { id: 'sku', header: 'SKU', value: { type: 'path', path: 'service_sku' }, style: { inline: { width: '14%' } } },
      { id: 'fulfillment', header: 'Fulfillment', value: { type: 'path', path: 'fulfillment_type' }, style: { inline: { width: '14%' } } },
      { id: 'ordered', header: 'Ordered', value: { type: 'path', path: 'quantity_ordered' }, format: 'number', style: { inline: { textAlign: 'right', width: '9%' } } },
      { id: 'fulfilled', header: 'Fulfilled', value: { type: 'path', path: 'quantity_fulfilled' }, format: 'number', style: { inline: { textAlign: 'right', width: '9%' } } },
      { id: 'unit-price', header: 'Unit Price', value: { type: 'path', path: 'unit_price' }, format: 'currency', style: { inline: { textAlign: 'right', width: '10%' } } },
      { id: 'amount', header: 'Amount', value: { type: 'path', path: 'amount' }, format: 'currency', style: { inline: { textAlign: 'right', width: '10%' } } },
    ];
  }
  return ast;
};

export const STANDARD_SALES_ORDER_TEMPLATE_ASTS: Record<string, TemplateAst> = {
  'standard-sales-order-confirmation': buildStandardSalesOrderConfirmationAst(),
  'standard-sales-order-detailed': buildStandardSalesOrderDetailedAst(),
};

export const STANDARD_SALES_ORDER_CONFIRMATION_CODE = 'standard-sales-order-confirmation';
export const STANDARD_SALES_ORDER_DETAILED_CODE = 'standard-sales-order-detailed';

export const getStandardSalesOrderTemplateAstByCode = (code: string): TemplateAst | null => {
  const ast = STANDARD_SALES_ORDER_TEMPLATE_ASTS[code];
  return ast ? cloneAst(ast) : null;
};

export { buildStandardSalesOrderConfirmationAst };
