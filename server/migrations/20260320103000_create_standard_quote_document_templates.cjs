const TABLE_NAME = 'standard_quote_document_templates';

const buildBindings = () => ({
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
  },
  collections: {
    lineItems: { id: 'lineItems', kind: 'collection', path: 'line_items' },
    phases: { id: 'phases', kind: 'collection', path: 'phases' },
  },
});

const bindings = buildBindings();

const s = (obj) => ({ inline: obj });

const DEFAULT_AST = {
  kind: 'invoice-template-ast',
  version: 1,
  metadata: { templateName: 'Standard Quote Default', printSettings: { paperPreset: 'Letter', marginMm: 10.58 } },
  bindings,
  layout: {
    id: 'root', type: 'document',
    children: [
      // Header: logo + quote meta card
      { id: 'header-top', type: 'stack', direction: 'row', style: s({ justifyContent: 'space-between', alignItems: 'flex-start', gap: '24px', margin: '0 0 20px 0' }), children: [
        { id: 'issuer-brand', type: 'stack', direction: 'column', style: s({ gap: '6px' }), children: [
          { id: 'issuer-logo', type: 'image', src: { type: 'binding', bindingId: 'tenantLogo' }, alt: { type: 'template', template: '{{name}} logo', args: { name: { type: 'binding', bindingId: 'tenantName' } } }, style: s({ width: '180px', maxHeight: '72px', margin: '0 0 6px 0' }) },
          { id: 'issuer-name', type: 'text', content: { type: 'binding', bindingId: 'tenantName' }, style: s({ fontSize: '18px', fontWeight: 700, lineHeight: 1.2 }) },
          { id: 'issuer-address', type: 'text', content: { type: 'binding', bindingId: 'tenantAddress' }, style: s({ color: '#4b5563', lineHeight: 1.4 }) },
        ] },
        { id: 'quote-meta-card', type: 'stack', direction: 'column', style: s({ minWidth: '280px', border: '1px solid #d1d5db', borderRadius: '10px', padding: '14px 16px', backgroundColor: '#f9fafb', gap: '6px' }), children: [
          { id: 'quote-title', type: 'text', content: { type: 'literal', value: 'QUOTE' }, style: s({ fontSize: '22px', fontWeight: 700, margin: '0 0 4px 0', lineHeight: 1.1 }) },
          { id: 'quote-number', type: 'field', label: 'Quote #', binding: { bindingId: 'quoteNumber' }, style: s({ justifyContent: 'space-between' }) },
          { id: 'quote-date', type: 'field', label: 'Date', binding: { bindingId: 'quoteDate' }, format: 'date', style: s({ justifyContent: 'space-between' }) },
          { id: 'valid-until', type: 'field', label: 'Valid Until', binding: { bindingId: 'validUntil' }, format: 'date', style: s({ justifyContent: 'space-between' }) },
          { id: 'po-number', type: 'field', label: 'PO #', binding: { bindingId: 'poNumber' }, emptyValue: '-', style: s({ justifyContent: 'space-between' }) },
        ] },
      ] },
      { id: 'header-divider', type: 'divider', style: s({ margin: '0 0 20px 0' }) },
      // Party blocks
      { id: 'party-blocks', type: 'stack', direction: 'row', style: s({ gap: '24px', margin: '0 0 20px 0' }), children: [
        { id: 'from-card', type: 'stack', direction: 'column', style: s({ flex: '1', gap: '4px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px' }), children: [
          { id: 'from-label', type: 'text', content: { type: 'literal', value: 'From' }, style: s({ color: '#6b7280', fontSize: '12px', fontWeight: 700, margin: '0 0 2px 0' }) },
          { id: 'from-name', type: 'text', content: { type: 'binding', bindingId: 'tenantName' }, style: s({ fontSize: '15px', fontWeight: 600, lineHeight: 1.3 }) },
          { id: 'from-address', type: 'text', content: { type: 'binding', bindingId: 'tenantAddress' }, style: s({ color: '#4b5563', lineHeight: 1.4 }) },
        ] },
        { id: 'prepared-for-card', type: 'stack', direction: 'column', style: s({ flex: '1', gap: '4px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px' }), children: [
          { id: 'prepared-for-label', type: 'text', content: { type: 'literal', value: 'Prepared For' }, style: s({ color: '#6b7280', fontSize: '12px', fontWeight: 700, margin: '0 0 2px 0' }) },
          { id: 'client-name', type: 'text', content: { type: 'binding', bindingId: 'clientName' }, style: s({ fontSize: '15px', fontWeight: 600, lineHeight: 1.3 }) },
          { id: 'client-address', type: 'text', content: { type: 'binding', bindingId: 'clientAddress' }, style: s({ color: '#4b5563', lineHeight: 1.4 }) },
          { id: 'contact-name', type: 'text', content: { type: 'binding', bindingId: 'contactName' }, style: s({ color: '#4b5563', lineHeight: 1.4 }) },
        ] },
      ] },
      // Title & scope
      { id: 'overview-section', type: 'stack', direction: 'column', style: s({ margin: '0 0 20px 0', gap: '8px' }), children: [
        { id: 'quote-heading', type: 'text', content: { type: 'binding', bindingId: 'title' }, style: s({ fontSize: '18px', fontWeight: 700, lineHeight: 1.3 }) },
        { id: 'scope-text', type: 'text', content: { type: 'binding', bindingId: 'scope' }, style: s({ color: '#374151', lineHeight: 1.5 }) },
      ] },
      // Line items
      { id: 'line-items', type: 'dynamic-table', style: s({ margin: '0 0 16px 0', border: '1px solid #e5e7eb', borderRadius: '10px' }), repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' }, emptyStateText: 'No line items', columns: [
        { id: 'description', header: 'Description', value: { type: 'path', path: 'description' }, style: s({ width: '50%' }) },
        { id: 'quantity', header: 'Qty', value: { type: 'path', path: 'quantity' }, format: 'number', style: s({ textAlign: 'right', width: '14%' }) },
        { id: 'unit-price', header: 'Rate', value: { type: 'path', path: 'unit_price' }, format: 'currency', style: s({ textAlign: 'right', width: '18%' }) },
        { id: 'amount', header: 'Amount', value: { type: 'path', path: 'total_price' }, format: 'currency', style: s({ textAlign: 'right', width: '18%' }) },
      ] },
      // Totals
      { id: 'totals-wrap', type: 'stack', direction: 'row', style: s({ justifyContent: 'flex-end', margin: '0 0 24px 0' }), children: [
        { id: 'totals', type: 'totals', style: s({ width: '300px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px 12px', backgroundColor: '#f9fafb' }), sourceBinding: { bindingId: 'lineItems' }, rows: [
          { id: 'subtotal', label: 'Subtotal', value: { type: 'binding', bindingId: 'subtotal' }, format: 'currency' },
          { id: 'discounts', label: 'Discounts', value: { type: 'binding', bindingId: 'discountTotal' }, format: 'currency' },
          { id: 'tax', label: 'Tax', value: { type: 'binding', bindingId: 'tax' }, format: 'currency' },
          { id: 'grand-total', label: 'Total', value: { type: 'binding', bindingId: 'total' }, format: 'currency', emphasize: true },
        ] },
      ] },
      // Notes
      { id: 'client-notes-section', type: 'section', title: 'Notes', children: [
        { id: 'client-notes-copy', type: 'text', content: { type: 'binding', bindingId: 'clientNotes' }, style: s({ color: '#374151', lineHeight: 1.5 }) },
      ] },
      // Terms
      { id: 'terms-section', type: 'section', title: 'Terms & Conditions', children: [
        { id: 'terms-copy', type: 'text', content: { type: 'binding', bindingId: 'termsAndConditions' }, style: s({ color: '#374151', lineHeight: 1.5, fontSize: '13px' }) },
      ] },
      // Signature block
      { id: 'signature-block', type: 'stack', direction: 'row', style: s({ gap: '48px', margin: '40px 0 0 0' }), children: [
        { id: 'sig-client', type: 'stack', direction: 'column', style: s({ flex: '1', gap: '4px' }), children: [
          { id: 'sig-client-label', type: 'text', content: { type: 'literal', value: 'Accepted By' }, style: s({ color: '#6b7280', fontSize: '12px', fontWeight: 700 }) },
          { id: 'sig-client-line', type: 'divider', style: s({ margin: '24px 0 4px 0', borderColor: '#000' }) },
          { id: 'sig-client-name', type: 'text', content: { type: 'literal', value: 'Signature' }, style: s({ color: '#9ca3af', fontSize: '12px' }) },
          { id: 'sig-client-date-line', type: 'divider', style: s({ margin: '20px 0 4px 0', borderColor: '#000' }) },
          { id: 'sig-client-date', type: 'text', content: { type: 'literal', value: 'Date' }, style: s({ color: '#9ca3af', fontSize: '12px' }) },
        ] },
        { id: 'sig-issuer', type: 'stack', direction: 'column', style: s({ flex: '1', gap: '4px' }), children: [
          { id: 'sig-issuer-label', type: 'text', content: { type: 'literal', value: 'Authorized By' }, style: s({ color: '#6b7280', fontSize: '12px', fontWeight: 700 }) },
          { id: 'sig-issuer-line', type: 'divider', style: s({ margin: '24px 0 4px 0', borderColor: '#000' }) },
          { id: 'sig-issuer-name', type: 'text', content: { type: 'literal', value: 'Signature' }, style: s({ color: '#9ca3af', fontSize: '12px' }) },
          { id: 'sig-issuer-date-line', type: 'divider', style: s({ margin: '20px 0 4px 0', borderColor: '#000' }) },
          { id: 'sig-issuer-date', type: 'text', content: { type: 'literal', value: 'Date' }, style: s({ color: '#9ca3af', fontSize: '12px' }) },
        ] },
      ] },
    ],
  },
};

const DETAILED_AST = {
  kind: 'invoice-template-ast',
  version: 1,
  metadata: { templateName: 'Standard Quote Detailed', printSettings: { paperPreset: 'Letter', marginMm: 10.58 } },
  bindings,
  layout: {
    id: 'root', type: 'document',
    children: [
      // Header: logo + quote meta card
      { id: 'header-top', type: 'stack', direction: 'row', style: s({ justifyContent: 'space-between', alignItems: 'flex-start', gap: '24px', margin: '0 0 20px 0' }), children: [
        { id: 'issuer-brand', type: 'stack', direction: 'column', style: s({ gap: '6px' }), children: [
          { id: 'issuer-logo', type: 'image', src: { type: 'binding', bindingId: 'tenantLogo' }, alt: { type: 'template', template: '{{name}} logo', args: { name: { type: 'binding', bindingId: 'tenantName' } } }, style: s({ width: '180px', maxHeight: '72px', margin: '0 0 6px 0' }) },
          { id: 'issuer-name', type: 'text', content: { type: 'binding', bindingId: 'tenantName' }, style: s({ fontSize: '18px', fontWeight: 700, lineHeight: 1.2 }) },
          { id: 'issuer-address', type: 'text', content: { type: 'binding', bindingId: 'tenantAddress' }, style: s({ color: '#4b5563', lineHeight: 1.4 }) },
        ] },
        { id: 'quote-meta-card', type: 'stack', direction: 'column', style: s({ minWidth: '280px', border: '1px solid #d1d5db', borderRadius: '10px', padding: '14px 16px', backgroundColor: '#f9fafb', gap: '6px' }), children: [
          { id: 'quote-title', type: 'text', content: { type: 'literal', value: 'QUOTE' }, style: s({ fontSize: '22px', fontWeight: 700, margin: '0 0 4px 0', lineHeight: 1.1 }) },
          { id: 'quote-number', type: 'field', label: 'Quote #', binding: { bindingId: 'quoteNumber' }, style: s({ justifyContent: 'space-between' }) },
          { id: 'quote-date', type: 'field', label: 'Date', binding: { bindingId: 'quoteDate' }, format: 'date', style: s({ justifyContent: 'space-between' }) },
          { id: 'valid-until', type: 'field', label: 'Valid Until', binding: { bindingId: 'validUntil' }, format: 'date', style: s({ justifyContent: 'space-between' }) },
          { id: 'po-number', type: 'field', label: 'PO #', binding: { bindingId: 'poNumber' }, emptyValue: '-', style: s({ justifyContent: 'space-between' }) },
          { id: 'version', type: 'field', label: 'Version', binding: { bindingId: 'version' }, style: s({ justifyContent: 'space-between' }) },
        ] },
      ] },
      { id: 'header-divider', type: 'divider', style: s({ margin: '0 0 20px 0' }) },
      // Party blocks
      { id: 'party-blocks', type: 'stack', direction: 'row', style: s({ gap: '24px', margin: '0 0 20px 0' }), children: [
        { id: 'from-card', type: 'stack', direction: 'column', style: s({ flex: '1', gap: '4px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px' }), children: [
          { id: 'from-label', type: 'text', content: { type: 'literal', value: 'From' }, style: s({ color: '#6b7280', fontSize: '12px', fontWeight: 700, margin: '0 0 2px 0' }) },
          { id: 'from-name', type: 'text', content: { type: 'binding', bindingId: 'tenantName' }, style: s({ fontSize: '15px', fontWeight: 600, lineHeight: 1.3 }) },
          { id: 'from-address', type: 'text', content: { type: 'binding', bindingId: 'tenantAddress' }, style: s({ color: '#4b5563', lineHeight: 1.4 }) },
        ] },
        { id: 'prepared-for-card', type: 'stack', direction: 'column', style: s({ flex: '1', gap: '4px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px' }), children: [
          { id: 'prepared-for-label', type: 'text', content: { type: 'literal', value: 'Prepared For' }, style: s({ color: '#6b7280', fontSize: '12px', fontWeight: 700, margin: '0 0 2px 0' }) },
          { id: 'client-name', type: 'text', content: { type: 'binding', bindingId: 'clientName' }, style: s({ fontSize: '15px', fontWeight: 600, lineHeight: 1.3 }) },
          { id: 'client-address', type: 'text', content: { type: 'binding', bindingId: 'clientAddress' }, style: s({ color: '#4b5563', lineHeight: 1.4 }) },
          { id: 'contact-name', type: 'text', content: { type: 'binding', bindingId: 'contactName' }, style: s({ color: '#4b5563', lineHeight: 1.4 }) },
        ] },
      ] },
      // Overview
      { id: 'overview-section', type: 'stack', direction: 'column', style: s({ margin: '0 0 20px 0', gap: '8px' }), children: [
        { id: 'quote-heading', type: 'text', content: { type: 'binding', bindingId: 'title' }, style: s({ fontSize: '18px', fontWeight: 700, lineHeight: 1.3 }) },
        { id: 'scope-text', type: 'text', content: { type: 'binding', bindingId: 'scope' }, style: s({ color: '#374151', lineHeight: 1.5 }) },
        { id: 'client-notes-text', type: 'text', content: { type: 'binding', bindingId: 'clientNotes' }, style: s({ color: '#374151', lineHeight: 1.5, fontStyle: 'italic' }) },
      ] },
      // Phase summary
      { id: 'phase-summary', type: 'dynamic-table', style: s({ margin: '0 0 16px 0', border: '1px solid #e5e7eb', borderRadius: '10px' }), repeat: { sourceBinding: { bindingId: 'phases' }, itemBinding: 'phase' }, emptyStateText: 'No phases defined', columns: [
        { id: 'phase-name', header: 'Project Phase', value: { type: 'path', path: 'name' }, style: s({ width: '100%' }) },
      ] },
      // Detailed line items
      { id: 'line-items-detailed', type: 'dynamic-table', style: s({ margin: '0 0 16px 0', border: '1px solid #e5e7eb', borderRadius: '10px' }), repeat: { sourceBinding: { bindingId: 'lineItems' }, itemBinding: 'item' }, emptyStateText: 'No line items', columns: [
        { id: 'description', header: 'Description', value: { type: 'path', path: 'description' }, style: s({ width: '36%' }) },
        { id: 'phase', header: 'Phase', value: { type: 'path', path: 'phase' }, style: s({ width: '14%' }) },
        { id: 'optional', header: 'Optional', value: { type: 'path', path: 'is_optional' }, style: s({ width: '8%', textAlign: 'center' }) },
        { id: 'recurring', header: 'Recurring', value: { type: 'path', path: 'is_recurring' }, style: s({ width: '8%', textAlign: 'center' }) },
        { id: 'quantity', header: 'Qty', value: { type: 'path', path: 'quantity' }, format: 'number', style: s({ textAlign: 'right', width: '8%' }) },
        { id: 'unit-price', header: 'Rate', value: { type: 'path', path: 'unit_price' }, format: 'currency', style: s({ textAlign: 'right', width: '13%' }) },
        { id: 'amount', header: 'Amount', value: { type: 'path', path: 'total_price' }, format: 'currency', style: s({ textAlign: 'right', width: '13%' }) },
      ] },
      // Totals
      { id: 'totals-wrap', type: 'stack', direction: 'row', style: s({ justifyContent: 'flex-end', margin: '0 0 24px 0' }), children: [
        { id: 'totals', type: 'totals', style: s({ width: '300px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px 12px', backgroundColor: '#f9fafb' }), sourceBinding: { bindingId: 'lineItems' }, rows: [
          { id: 'subtotal', label: 'Subtotal', value: { type: 'binding', bindingId: 'subtotal' }, format: 'currency' },
          { id: 'discounts', label: 'Discounts', value: { type: 'binding', bindingId: 'discountTotal' }, format: 'currency' },
          { id: 'tax', label: 'Tax', value: { type: 'binding', bindingId: 'tax' }, format: 'currency' },
          { id: 'grand-total', label: 'Total', value: { type: 'binding', bindingId: 'total' }, format: 'currency', emphasize: true },
        ] },
      ] },
      // Terms
      { id: 'terms-section', type: 'section', title: 'Terms & Conditions', children: [
        { id: 'terms-copy', type: 'text', content: { type: 'binding', bindingId: 'termsAndConditions' }, style: s({ color: '#374151', lineHeight: 1.5, fontSize: '13px' }) },
      ] },
      // Signature block
      { id: 'signature-block', type: 'stack', direction: 'row', style: s({ gap: '48px', margin: '40px 0 0 0' }), children: [
        { id: 'sig-client', type: 'stack', direction: 'column', style: s({ flex: '1', gap: '4px' }), children: [
          { id: 'sig-client-label', type: 'text', content: { type: 'literal', value: 'Accepted By' }, style: s({ color: '#6b7280', fontSize: '12px', fontWeight: 700 }) },
          { id: 'sig-client-line', type: 'divider', style: s({ margin: '24px 0 4px 0', borderColor: '#000' }) },
          { id: 'sig-client-name', type: 'text', content: { type: 'literal', value: 'Signature' }, style: s({ color: '#9ca3af', fontSize: '12px' }) },
          { id: 'sig-client-date-line', type: 'divider', style: s({ margin: '20px 0 4px 0', borderColor: '#000' }) },
          { id: 'sig-client-date', type: 'text', content: { type: 'literal', value: 'Date' }, style: s({ color: '#9ca3af', fontSize: '12px' }) },
        ] },
        { id: 'sig-issuer', type: 'stack', direction: 'column', style: s({ flex: '1', gap: '4px' }), children: [
          { id: 'sig-issuer-label', type: 'text', content: { type: 'literal', value: 'Authorized By' }, style: s({ color: '#6b7280', fontSize: '12px', fontWeight: 700 }) },
          { id: 'sig-issuer-line', type: 'divider', style: s({ margin: '24px 0 4px 0', borderColor: '#000' }) },
          { id: 'sig-issuer-name', type: 'text', content: { type: 'literal', value: 'Signature' }, style: s({ color: '#9ca3af', fontSize: '12px' }) },
          { id: 'sig-issuer-date-line', type: 'divider', style: s({ margin: '20px 0 4px 0', borderColor: '#000' }) },
          { id: 'sig-issuer-date', type: 'text', content: { type: 'literal', value: 'Date' }, style: s({ color: '#9ca3af', fontSize: '12px' }) },
        ] },
      ] },
    ],
  },
};

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable(TABLE_NAME);

  if (!exists) {
    await knex.schema.createTable(TABLE_NAME, (table) => {
      table.uuid('template_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
      table.text('name').notNullable();
      table.integer('version').notNullable();
      table.text('standard_quote_document_template_code').notNullable().unique();
      table.jsonb('templateAst').notNullable();
      table.boolean('is_default').notNullable().defaultTo(false);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    });
  }

  await knex(TABLE_NAME)
    .insert([
      {
        name: 'Standard Quote Template',
        version: 1,
        standard_quote_document_template_code: 'standard-quote-default',
        templateAst: DEFAULT_AST,
        is_default: true,
      },
      {
        name: 'Detailed Quote Template',
        version: 1,
        standard_quote_document_template_code: 'standard-quote-detailed',
        templateAst: DETAILED_AST,
        is_default: false,
      },
    ])
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
  await knex.schema.dropTableIfExists(TABLE_NAME);
};
