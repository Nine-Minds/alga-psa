/**
 * Seed the `standard-invoice-by-location` template into
 * `standard_invoice_templates` so it shows up in the invoice template
 * management UI and is selectable as a client's default invoice template.
 *
 * The template already exists in code at
 * `packages/billing/src/lib/invoice-template-ast/standardTemplates.ts`
 * (buildStandardByLocationAst) and is wired into the PDF-generation auto-
 * branch for multi-location invoices. This migration makes it visible to
 * end users.
 *
 * Shape: repeating stack `location-bands` driven by the `groupsByLocation`
 * collection binding. Each iteration renders a location band with:
 *   - a header stack bound to the current group item (location-band-header)
 *   - a dynamic-table bound to `group.items` (location-band-items)
 *   - a subtotal row reading `group.subtotal` (location-band-subtotal)
 *
 * This replaces an earlier two-table approximation (location summary table
 * + flat line items table with a Location column). The primitive powering
 * the repeat is the optional `repeat` on stack nodes — see
 * packages/types/src/lib/invoice-template-ast.ts (TemplateStackNode).
 */

const INVOICE_TABLE = 'standard_invoice_templates';
const CODE = 'standard-invoice-by-location';

const buildSharedBindings = () => ({
  values: {
    invoiceNumber: { id: 'invoiceNumber', kind: 'value', path: 'invoiceNumber' },
    issueDate: { id: 'issueDate', kind: 'value', path: 'issueDate' },
    dueDate: { id: 'dueDate', kind: 'value', path: 'dueDate' },
    recurringServicePeriodStart: { id: 'recurringServicePeriodStart', kind: 'value', path: 'recurringServicePeriodStart' },
    recurringServicePeriodEnd: { id: 'recurringServicePeriodEnd', kind: 'value', path: 'recurringServicePeriodEnd' },
    recurringServicePeriodLabel: { id: 'recurringServicePeriodLabel', kind: 'value', path: 'recurringServicePeriodLabel' },
    poNumber: { id: 'poNumber', kind: 'value', path: 'poNumber' },
    subtotal: { id: 'subtotal', kind: 'value', path: 'subtotal' },
    tax: { id: 'tax', kind: 'value', path: 'tax' },
    total: { id: 'total', kind: 'value', path: 'total' },
    notes: { id: 'notes', kind: 'value', path: 'notes', fallback: '' },
    tenantClientName: { id: 'tenantClientName', kind: 'value', path: 'tenantClient.name', fallback: 'Your Company' },
    tenantClientAddress: { id: 'tenantClientAddress', kind: 'value', path: 'tenantClient.address', fallback: 'Company address' },
    tenantClientLogo: { id: 'tenantClientLogo', kind: 'value', path: 'tenantClient.logoUrl' },
    customerName: { id: 'customerName', kind: 'value', path: 'customer.name', fallback: 'Customer' },
    customerAddress: { id: 'customerAddress', kind: 'value', path: 'customer.address', fallback: 'Customer address' },
    recurringSubtotal: { id: 'recurringSubtotal', kind: 'value', path: 'recurringSubtotal' },
    recurringTax: { id: 'recurringTax', kind: 'value', path: 'recurringTax' },
    recurringTotal: { id: 'recurringTotal', kind: 'value', path: 'recurringTotal' },
    onetimeSubtotal: { id: 'onetimeSubtotal', kind: 'value', path: 'onetimeSubtotal' },
    onetimeTax: { id: 'onetimeTax', kind: 'value', path: 'onetimeTax' },
    onetimeTotal: { id: 'onetimeTotal', kind: 'value', path: 'onetimeTotal' },
  },
  collections: {
    lineItems: { id: 'lineItems', kind: 'collection', path: 'items' },
    recurringItems: { id: 'recurringItems', kind: 'collection', path: 'recurringItems' },
    onetimeItems: { id: 'onetimeItems', kind: 'collection', path: 'onetimeItems' },
    groupsByLocation: { id: 'groupsByLocation', kind: 'collection', path: 'groupsByLocation' },
  },
});

const INVOICE_BY_LOCATION_AST = {
  kind: 'invoice-template-ast',
  version: 1,
  metadata: {
    templateName: 'Standard Invoice By Location',
    printSettings: { paperPreset: 'Letter', marginMm: 10.58 },
  },
  bindings: buildSharedBindings(),
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
              {
                id: 'issuer-logo',
                type: 'image',
                src: { type: 'binding', bindingId: 'tenantClientLogo' },
                alt: { type: 'template', template: '{{name}} logo', args: { name: { type: 'binding', bindingId: 'tenantClientName' } } },
                style: { inline: { width: '180px', maxHeight: '72px', margin: '0 0 6px 0' } },
              },
              { id: 'issuer-name', type: 'text', content: { type: 'binding', bindingId: 'tenantClientName' }, style: { inline: { fontSize: '18px', fontWeight: 700, lineHeight: 1.2 } } },
              { id: 'issuer-address', type: 'text', content: { type: 'binding', bindingId: 'tenantClientAddress' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
            ],
          },
          {
            id: 'invoice-meta-card',
            type: 'stack',
            direction: 'column',
            style: { inline: { minWidth: '280px', border: '1px solid #d1d5db', borderRadius: '10px', padding: '14px 16px', backgroundColor: '#f9fafb', gap: '6px' } },
            children: [
              { id: 'invoice-title', type: 'text', content: { type: 'literal', value: 'INVOICE' }, style: { inline: { fontSize: '22px', fontWeight: 700, margin: '0 0 4px 0', lineHeight: 1.1 } } },
              { id: 'invoice-number', type: 'field', label: 'Invoice #', binding: { bindingId: 'invoiceNumber' }, style: { inline: { justifyContent: 'space-between' } } },
              { id: 'issue-date', type: 'field', label: 'Issue Date', binding: { bindingId: 'issueDate' }, format: 'date', style: { inline: { justifyContent: 'space-between' } } },
              { id: 'due-date', type: 'field', label: 'Due Date', binding: { bindingId: 'dueDate' }, format: 'date', style: { inline: { justifyContent: 'space-between' } } },
              { id: 'po-number', type: 'field', label: 'PO #', binding: { bindingId: 'poNumber' }, emptyValue: '-', style: { inline: { justifyContent: 'space-between' } } },
            ],
          },
        ],
      },
      { id: 'header-divider', type: 'divider', style: { inline: { margin: '0 0 20px 0' } } },
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
              { id: 'from-name', type: 'text', content: { type: 'binding', bindingId: 'tenantClientName' }, style: { inline: { fontSize: '15px', fontWeight: 600, lineHeight: 1.3 } } },
              { id: 'from-address', type: 'text', content: { type: 'binding', bindingId: 'tenantClientAddress' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
            ],
          },
          {
            id: 'bill-to-card',
            type: 'stack',
            direction: 'column',
            style: { inline: { flex: '1', gap: '4px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px' } },
            children: [
              { id: 'bill-to-label', type: 'text', content: { type: 'literal', value: 'Bill To' }, style: { inline: { color: '#6b7280', fontSize: '12px', fontWeight: 700, margin: '0 0 2px 0' } } },
              { id: 'bill-to-name', type: 'text', content: { type: 'binding', bindingId: 'customerName' }, style: { inline: { fontSize: '15px', fontWeight: 600, lineHeight: 1.3 } } },
              { id: 'bill-to-address', type: 'text', content: { type: 'binding', bindingId: 'customerAddress' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
            ],
          },
        ],
      },
      // ── Per-location bands: header + items table + subtotal row ───
      // One iteration per item in `groupsByLocation`. The outer stack uses
      // `repeat.itemBinding = 'group'`, so the inner dynamic-table reads its
      // rows from `group.items` via scope-resolved binding lookup. `path`
      // expressions inside resolve against the current group item (see
      // RenderScope.row in packages/billing/src/lib/invoice-template-ast/
      // react-renderer.tsx).
      {
        id: 'location-bands',
        type: 'stack',
        direction: 'column',
        style: { inline: { gap: '8px', margin: '0 0 16px 0' } },
        repeat: { sourceBinding: { bindingId: 'groupsByLocation' }, itemBinding: 'group' },
        children: [
          {
            id: 'location-band-header',
            type: 'stack',
            direction: 'column',
            style: { inline: { gap: '2px', backgroundColor: '#7c45d3', color: '#ffffff', padding: '6px 12px', borderRadius: '6px 6px 0 0' } },
            children: [
              { id: 'location-band-name', type: 'text', content: { type: 'path', path: 'name' }, style: { inline: { fontSize: '14px', fontWeight: 700, color: '#ffffff' } } },
              { id: 'location-band-address', type: 'text', content: { type: 'path', path: 'address' }, style: { inline: { fontSize: '12px', color: '#ffffff', lineHeight: 1.4 } } },
            ],
          },
          {
            id: 'location-band-items',
            type: 'dynamic-table',
            style: { inline: { margin: '0', border: '1px solid #e5e7eb', borderRadius: '0 0 6px 6px' } },
            repeat: { sourceBinding: { bindingId: 'group.items' }, itemBinding: 'item' },
            emptyStateText: 'No billable line items',
            columns: [
              { id: 'description', header: 'Description', value: { type: 'path', path: 'description' }, style: { inline: { width: '52%' } } },
              { id: 'quantity', header: 'Qty', value: { type: 'path', path: 'quantity' }, format: 'number', style: { inline: { textAlign: 'right', width: '12%' } } },
              { id: 'unit-price', header: 'Rate', value: { type: 'path', path: 'unitPrice' }, format: 'currency', style: { inline: { textAlign: 'right', width: '18%' } } },
              { id: 'line-total', header: 'Amount', value: { type: 'path', path: 'total' }, format: 'currency', style: { inline: { textAlign: 'right', width: '18%' } } },
            ],
          },
          {
            id: 'location-band-subtotal',
            type: 'stack',
            direction: 'row',
            style: { inline: { justifyContent: 'space-between', padding: '6px 12px', backgroundColor: '#f9fafb', borderRadius: '0 0 6px 6px' } },
            children: [
              { id: 'location-band-subtotal-label', type: 'text', content: { type: 'literal', value: 'Location Subtotal' }, style: { inline: { fontWeight: 700 } } },
              { id: 'location-band-subtotal-value', type: 'text', content: { type: 'path', path: 'subtotal|currency' }, style: { inline: { fontWeight: 700, textAlign: 'right' } } },
            ],
          },
        ],
      },
      {
        id: 'totals-wrap',
        type: 'stack',
        direction: 'row',
        style: { inline: { justifyContent: 'flex-end', margin: '0 0 24px 0' } },
        children: [
          {
            id: 'totals',
            type: 'totals',
            style: { inline: { width: '300px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px 12px', backgroundColor: '#f9fafb' } },
            sourceBinding: { bindingId: 'lineItems' },
            rows: [
              { id: 'subtotal', label: 'Subtotal', value: { type: 'binding', bindingId: 'subtotal' }, format: 'currency' },
              { id: 'tax', label: 'Tax', value: { type: 'binding', bindingId: 'tax' }, format: 'currency' },
              { id: 'total', label: 'Total', value: { type: 'binding', bindingId: 'total' }, format: 'currency', emphasize: true },
            ],
          },
        ],
      },
    ],
  },
};

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable(INVOICE_TABLE);
  if (!hasTable) return;

  const hasAstCol = await knex.schema.hasColumn(INVOICE_TABLE, 'templateAst');
  if (!hasAstCol) return;

  const existing = await knex(INVOICE_TABLE)
    .where({ standard_invoice_template_code: CODE })
    .first();

  if (existing) {
    await knex(INVOICE_TABLE)
      .where({ standard_invoice_template_code: CODE })
      .update({
        name: 'Standard Invoice By Location',
        version: 1,
        templateAst: knex.raw('?::jsonb', [JSON.stringify(INVOICE_BY_LOCATION_AST)]),
        updated_at: knex.fn.now(),
      });
  } else {
    await knex(INVOICE_TABLE).insert({
      template_id: knex.raw('gen_random_uuid()'),
      name: 'Standard Invoice By Location',
      version: 1,
      standard_invoice_template_code: CODE,
      is_default: false,
      templateAst: knex.raw('?::jsonb', [JSON.stringify(INVOICE_BY_LOCATION_AST)]),
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    });
  }
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable(INVOICE_TABLE);
  if (!hasTable) return;

  await knex(INVOICE_TABLE).where({ standard_invoice_template_code: CODE }).del();
};
