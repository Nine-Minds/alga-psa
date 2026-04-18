/**
 * Seed the `standard-quote-by-location` template into
 * `standard_quote_document_templates` so it is listed in the quote template
 * dropdown and can be explicitly selected on a quote.
 *
 * The template already exists as code in
 * `packages/billing/src/lib/quote-template-ast/standardTemplates.ts`
 * (buildStandardQuoteByLocationAst) and has been wired into the auto-branch
 * fallback for multi-location quotes. This migration makes it visible to
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

const QUOTE_TABLE = 'standard_quote_document_templates';
const CODE = 'standard-quote-by-location';

const buildQuoteBindings = () => ({
  values: {
    quoteNumber: { id: 'quoteNumber', kind: 'value', path: 'quote_number' },
    quoteDate: { id: 'quoteDate', kind: 'value', path: 'quote_date' },
    validUntil: { id: 'validUntil', kind: 'value', path: 'valid_until' },
    status: { id: 'status', kind: 'value', path: 'status' },
    title: { id: 'title', kind: 'value', path: 'title' },
    scope: { id: 'scope', kind: 'value', path: 'scope_of_work', fallback: '' },
    poNumber: { id: 'poNumber', kind: 'value', path: 'po_number' },
    subtotal: { id: 'subtotal', kind: 'value', path: 'subtotal' },
    discountTotal: { id: 'discountTotal', kind: 'value', path: 'discount_total' },
    tax: { id: 'tax', kind: 'value', path: 'tax' },
    total: { id: 'total', kind: 'value', path: 'total_amount' },
    termsAndConditions: { id: 'termsAndConditions', kind: 'value', path: 'terms_and_conditions', fallback: '' },
    clientNotes: { id: 'clientNotes', kind: 'value', path: 'client_notes', fallback: '' },
    version: { id: 'version', kind: 'value', path: 'version' },
    clientName: { id: 'clientName', kind: 'value', path: 'client.name', fallback: 'Client' },
    clientAddress: { id: 'clientAddress', kind: 'value', path: 'client.address', fallback: '' },
    contactName: { id: 'contactName', kind: 'value', path: 'contact.name', fallback: '' },
    tenantName: { id: 'tenantName', kind: 'value', path: 'tenant.name', fallback: 'Your Company' },
    tenantAddress: { id: 'tenantAddress', kind: 'value', path: 'tenant.address', fallback: '' },
    tenantLogo: { id: 'tenantLogo', kind: 'value', path: 'tenant.logo_url' },
    acceptedByName: { id: 'acceptedByName', kind: 'value', path: 'accepted_by_name', fallback: '' },
    acceptedAt: { id: 'acceptedAt', kind: 'value', path: 'accepted_at', fallback: '' },
  },
  collections: {
    lineItems: { id: 'lineItems', kind: 'collection', path: 'line_items' },
    phases: { id: 'phases', kind: 'collection', path: 'phases' },
    groupsByLocation: { id: 'groupsByLocation', kind: 'collection', path: 'groups_by_location' },
  },
});

const QUOTE_BY_LOCATION_AST = {
  kind: 'invoice-template-ast',
  version: 1,
  metadata: {
    templateName: 'Standard Quote By Location',
    printSettings: { paperPreset: 'Letter', marginMm: 10.58 },
  },
  bindings: buildQuoteBindings(),
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
                src: { type: 'binding', bindingId: 'tenantLogo' },
                alt: { type: 'template', template: '{{name}} logo', args: { name: { type: 'binding', bindingId: 'tenantName' } } },
                style: { inline: { width: '180px', maxHeight: '72px', margin: '0 0 6px 0' } },
              },
              { id: 'issuer-name', type: 'text', content: { type: 'binding', bindingId: 'tenantName' }, style: { inline: { fontSize: '18px', fontWeight: 700, lineHeight: 1.2 } } },
              { id: 'issuer-address', type: 'text', content: { type: 'binding', bindingId: 'tenantAddress' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
            ],
          },
          {
            id: 'quote-meta-card',
            type: 'stack',
            direction: 'column',
            style: { inline: { minWidth: '280px', border: '1px solid #d1d5db', borderRadius: '10px', padding: '14px 16px', backgroundColor: '#f9fafb', gap: '6px' } },
            children: [
              { id: 'quote-title', type: 'text', content: { type: 'literal', value: 'QUOTE' }, style: { inline: { fontSize: '22px', fontWeight: 700, margin: '0 0 4px 0', lineHeight: 1.1 } } },
              { id: 'quote-number', type: 'field', label: 'Quote #', binding: { bindingId: 'quoteNumber' }, style: { inline: { justifyContent: 'space-between' } } },
              { id: 'quote-date', type: 'field', label: 'Date', binding: { bindingId: 'quoteDate' }, format: 'date', style: { inline: { justifyContent: 'space-between' } } },
              { id: 'valid-until', type: 'field', label: 'Valid Until', binding: { bindingId: 'validUntil' }, format: 'date', style: { inline: { justifyContent: 'space-between' } } },
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
              { id: 'from-name', type: 'text', content: { type: 'binding', bindingId: 'tenantName' }, style: { inline: { fontSize: '15px', fontWeight: 600, lineHeight: 1.3 } } },
              { id: 'from-address', type: 'text', content: { type: 'binding', bindingId: 'tenantAddress' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
            ],
          },
          {
            id: 'prepared-for-card',
            type: 'stack',
            direction: 'column',
            style: { inline: { flex: '1', gap: '4px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px' } },
            children: [
              { id: 'prepared-for-label', type: 'text', content: { type: 'literal', value: 'Prepared For' }, style: { inline: { color: '#6b7280', fontSize: '12px', fontWeight: 700, margin: '0 0 2px 0' } } },
              { id: 'client-name', type: 'text', content: { type: 'binding', bindingId: 'clientName' }, style: { inline: { fontSize: '15px', fontWeight: 600, lineHeight: 1.3 } } },
              { id: 'client-address', type: 'text', content: { type: 'binding', bindingId: 'clientAddress' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
              { id: 'contact-name', type: 'text', content: { type: 'binding', bindingId: 'contactName' }, style: { inline: { color: '#4b5563', lineHeight: 1.4 } } },
            ],
          },
        ],
      },
      {
        id: 'overview-section',
        type: 'stack',
        direction: 'column',
        style: { inline: { margin: '0 0 20px 0', gap: '8px' } },
        children: [
          { id: 'quote-heading', type: 'text', content: { type: 'binding', bindingId: 'title' }, style: { inline: { fontSize: '18px', fontWeight: 700, lineHeight: 1.3 } } },
          { id: 'scope-text', type: 'text', content: { type: 'binding', bindingId: 'scope' }, style: { inline: { color: '#374151', lineHeight: 1.5 } } },
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
            emptyStateText: 'No line items',
            columns: [
              { id: 'description', header: 'Description', value: { type: 'path', path: 'description' }, style: { inline: { width: '52%' } } },
              { id: 'quantity', header: 'Qty', value: { type: 'path', path: 'quantity' }, format: 'number', style: { inline: { textAlign: 'right', width: '12%' } } },
              { id: 'unit-price', header: 'Rate', value: { type: 'path', path: 'unit_price' }, format: 'currency', style: { inline: { textAlign: 'right', width: '18%' } } },
              { id: 'amount', header: 'Amount', value: { type: 'path', path: 'total_price' }, format: 'currency', style: { inline: { textAlign: 'right', width: '18%' } } },
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
              { id: 'discounts', label: 'Discounts', value: { type: 'binding', bindingId: 'discountTotal' }, format: 'currency' },
              { id: 'tax', label: 'Tax', value: { type: 'binding', bindingId: 'tax' }, format: 'currency' },
              { id: 'grand-total', label: 'Total', value: { type: 'binding', bindingId: 'total' }, format: 'currency', emphasize: true },
            ],
          },
        ],
      },
      {
        id: 'client-notes-section',
        type: 'section',
        title: 'Notes',
        children: [
          { id: 'client-notes-copy', type: 'text', content: { type: 'binding', bindingId: 'clientNotes' }, style: { inline: { color: '#374151', lineHeight: 1.5 } } },
        ],
      },
      {
        id: 'terms-section',
        type: 'section',
        title: 'Terms & Conditions',
        children: [
          { id: 'terms-copy', type: 'text', content: { type: 'binding', bindingId: 'termsAndConditions' }, style: { inline: { color: '#374151', lineHeight: 1.5, fontSize: '13px' } } },
        ],
      },
      {
        id: 'signature-block',
        type: 'stack',
        direction: 'row',
        style: { inline: { gap: '48px', margin: '40px 0 0 0' } },
        children: [
          {
            id: 'sig-client',
            type: 'stack',
            direction: 'column',
            style: { inline: { flex: '1', gap: '4px' } },
            children: [
              { id: 'sig-client-label', type: 'text', content: { type: 'literal', value: 'Accepted By' }, style: { inline: { color: '#6b7280', fontSize: '12px', fontWeight: 700 } } },
              { id: 'sig-client-line', type: 'divider', style: { inline: { margin: '24px 0 4px 0', borderColor: '#000' } } },
              { id: 'sig-client-name', type: 'text', content: { type: 'binding', bindingId: 'acceptedByName' }, style: { inline: { color: '#9ca3af', fontSize: '12px' } } },
              { id: 'sig-client-date-line', type: 'divider', style: { inline: { margin: '20px 0 4px 0', borderColor: '#000' } } },
              { id: 'sig-client-date', type: 'text', content: { type: 'binding', bindingId: 'acceptedAt' }, style: { inline: { color: '#9ca3af', fontSize: '12px' } } },
            ],
          },
          {
            id: 'sig-issuer',
            type: 'stack',
            direction: 'column',
            style: { inline: { flex: '1', gap: '4px' } },
            children: [
              { id: 'sig-issuer-label', type: 'text', content: { type: 'literal', value: 'Authorized By' }, style: { inline: { color: '#6b7280', fontSize: '12px', fontWeight: 700 } } },
              { id: 'sig-issuer-line', type: 'divider', style: { inline: { margin: '24px 0 4px 0', borderColor: '#000' } } },
              { id: 'sig-issuer-name', type: 'text', content: { type: 'literal', value: 'Signature' }, style: { inline: { color: '#9ca3af', fontSize: '12px' } } },
              { id: 'sig-issuer-date-line', type: 'divider', style: { inline: { margin: '20px 0 4px 0', borderColor: '#000' } } },
              { id: 'sig-issuer-date', type: 'text', content: { type: 'literal', value: 'Date' }, style: { inline: { color: '#9ca3af', fontSize: '12px' } } },
            ],
          },
        ],
      },
    ],
  },
};

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable(QUOTE_TABLE);
  if (!hasTable) return;

  await knex(QUOTE_TABLE)
    .insert({
      name: 'Standard Quote By Location',
      version: 1,
      standard_quote_document_template_code: CODE,
      templateAst: QUOTE_BY_LOCATION_AST,
      is_default: false,
    })
    .onConflict('standard_quote_document_template_code')
    .merge({
      name: knex.raw('EXCLUDED.name'),
      version: knex.raw('EXCLUDED.version'),
      templateAst: knex.raw('EXCLUDED."templateAst"'),
      is_default: knex.raw('EXCLUDED.is_default'),
      updated_at: knex.fn.now(),
    });
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable(QUOTE_TABLE);
  if (!hasTable) return;

  await knex(QUOTE_TABLE).where({ standard_quote_document_template_code: CODE }).del();
};
