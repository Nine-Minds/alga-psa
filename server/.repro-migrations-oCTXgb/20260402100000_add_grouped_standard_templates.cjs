/**
 * Add "Grouped" standard templates for both invoices and quotes.
 *
 * These templates separate line items into Monthly/Recurring and One-time
 * sections with independent subtotals, tax, and totals for each group.
 */

const INVOICE_TABLE = 'standard_invoice_templates';
const QUOTE_TABLE = 'standard_quote_document_templates';

const s = (obj) => ({ inline: obj });

// ── Shared bindings for invoice grouped template ────────────────────────

const buildInvoiceBindings = () => ({
  values: {
    invoiceNumber: { id: 'invoiceNumber', kind: 'value', path: 'invoiceNumber' },
    issueDate: { id: 'issueDate', kind: 'value', path: 'issueDate' },
    dueDate: { id: 'dueDate', kind: 'value', path: 'dueDate' },
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
  },
});

const INVOICE_GROUPED_AST = {
  kind: 'invoice-template-ast',
  version: 1,
  metadata: { templateName: 'Grouped Template', printSettings: { paperPreset: 'Letter', marginMm: 10.58 } },
  bindings: buildInvoiceBindings(),
  layout: {
    id: 'root', type: 'document',
    children: [
      // Header
      { id: 'header-top', type: 'stack', direction: 'row', style: s({ justifyContent: 'space-between', alignItems: 'flex-start', gap: '24px', margin: '0 0 20px 0' }), children: [
        { id: 'issuer-brand', type: 'stack', direction: 'column', style: s({ gap: '6px' }), children: [
          { id: 'issuer-logo', type: 'image', src: { type: 'binding', bindingId: 'tenantClientLogo' }, alt: { type: 'template', template: '{{name}} logo', args: { name: { type: 'binding', bindingId: 'tenantClientName' } } }, style: s({ width: '180px', maxHeight: '72px', margin: '0 0 6px 0' }) },
          { id: 'issuer-name', type: 'text', content: { type: 'binding', bindingId: 'tenantClientName' }, style: s({ fontSize: '18px', fontWeight: 700, lineHeight: 1.2 }) },
          { id: 'issuer-address', type: 'text', content: { type: 'binding', bindingId: 'tenantClientAddress' }, style: s({ color: '#4b5563', lineHeight: 1.4 }) },
        ] },
        { id: 'invoice-meta-card', type: 'stack', direction: 'column', style: s({ minWidth: '280px', border: '1px solid #d1d5db', borderRadius: '10px', padding: '14px 16px', backgroundColor: '#f9fafb', gap: '6px' }), children: [
          { id: 'invoice-title', type: 'text', content: { type: 'literal', value: 'INVOICE' }, style: s({ fontSize: '22px', fontWeight: 700, margin: '0 0 4px 0', lineHeight: 1.1 }) },
          { id: 'invoice-number', type: 'field', label: 'Invoice #', binding: { bindingId: 'invoiceNumber' }, style: s({ justifyContent: 'space-between' }) },
          { id: 'issue-date', type: 'field', label: 'Issue Date', binding: { bindingId: 'issueDate' }, format: 'date', style: s({ justifyContent: 'space-between' }) },
          { id: 'due-date', type: 'field', label: 'Due Date', binding: { bindingId: 'dueDate' }, format: 'date', style: s({ justifyContent: 'space-between' }) },
          { id: 'po-number', type: 'field', label: 'PO #', binding: { bindingId: 'poNumber' }, emptyValue: '-', style: s({ justifyContent: 'space-between' }) },
        ] },
      ] },
      { id: 'header-divider', type: 'divider', style: s({ margin: '0 0 20px 0' }) },
      // Party blocks
      { id: 'party-blocks', type: 'stack', direction: 'row', style: s({ gap: '24px', margin: '0 0 20px 0' }), children: [
        { id: 'from-card', type: 'stack', direction: 'column', style: s({ flex: '1', gap: '4px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px' }), children: [
          { id: 'from-label', type: 'text', content: { type: 'literal', value: 'From' }, style: s({ color: '#6b7280', fontSize: '12px', fontWeight: 700, margin: '0 0 2px 0' }) },
          { id: 'from-name', type: 'text', content: { type: 'binding', bindingId: 'tenantClientName' }, style: s({ fontSize: '15px', fontWeight: 600, lineHeight: 1.3 }) },
          { id: 'from-address', type: 'text', content: { type: 'binding', bindingId: 'tenantClientAddress' }, style: s({ color: '#4b5563', lineHeight: 1.4 }) },
        ] },
        { id: 'bill-to-card', type: 'stack', direction: 'column', style: s({ flex: '1', gap: '4px', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px' }), children: [
          { id: 'bill-to-label', type: 'text', content: { type: 'literal', value: 'Bill To' }, style: s({ color: '#6b7280', fontSize: '12px', fontWeight: 700, margin: '0 0 2px 0' }) },
          { id: 'bill-to-name', type: 'text', content: { type: 'binding', bindingId: 'customerName' }, style: s({ fontSize: '15px', fontWeight: 600, lineHeight: 1.3 }) },
          { id: 'bill-to-address', type: 'text', content: { type: 'binding', bindingId: 'customerAddress' }, style: s({ color: '#4b5563', lineHeight: 1.4 }) },
        ] },
      ] },
      // Recurring items
      { id: 'recurring-section-label', type: 'text', content: { type: 'literal', value: 'Monthly Items' }, style: s({ fontSize: '14px', fontWeight: 700, color: '#ffffff', backgroundColor: '#7c45d3', padding: '6px 12px', borderRadius: '6px 6px 0 0', margin: '0' }) },
      { id: 'recurring-items', type: 'dynamic-table', style: s({ margin: '0 0 16px 0', border: '1px solid #e5e7eb', borderRadius: '0 6px 6px 6px' }), headerStyle: s({ backgroundColor: '#7c45d3', color: '#ffffff' }), repeat: { sourceBinding: { bindingId: 'recurringItems' }, itemBinding: 'item' }, emptyStateText: 'No monthly items', columns: [
        { id: 'description', header: 'Description', value: { type: 'path', path: 'description' }, style: s({ width: '50%' }) },
        { id: 'unit-price', header: 'Price', value: { type: 'path', path: 'unitPrice' }, format: 'currency', style: s({ textAlign: 'right', width: '18%' }) },
        { id: 'quantity', header: 'Qty', value: { type: 'path', path: 'quantity' }, format: 'number', style: s({ textAlign: 'right', width: '14%' }) },
        { id: 'line-total', header: 'Amount', value: { type: 'path', path: 'total' }, format: 'currency', style: s({ textAlign: 'right', width: '18%' }) },
      ] },
      // One-time items
      { id: 'onetime-section-label', type: 'text', content: { type: 'literal', value: 'One-time Items' }, style: s({ fontSize: '14px', fontWeight: 700, color: '#ffffff', backgroundColor: '#7c45d3', padding: '6px 12px', borderRadius: '6px 6px 0 0', margin: '0' }) },
      { id: 'onetime-items', type: 'dynamic-table', style: s({ margin: '0 0 16px 0', border: '1px solid #e5e7eb', borderRadius: '0 6px 6px 6px' }), headerStyle: s({ backgroundColor: '#7c45d3', color: '#ffffff' }), repeat: { sourceBinding: { bindingId: 'onetimeItems' }, itemBinding: 'item' }, emptyStateText: 'No one-time items', columns: [
        { id: 'description', header: 'Description', value: { type: 'path', path: 'description' }, style: s({ width: '50%' }) },
        { id: 'unit-price', header: 'Price', value: { type: 'path', path: 'unitPrice' }, format: 'currency', style: s({ textAlign: 'right', width: '18%' }) },
        { id: 'quantity', header: 'Qty', value: { type: 'path', path: 'quantity' }, format: 'number', style: s({ textAlign: 'right', width: '14%' }) },
        { id: 'line-total', header: 'Amount', value: { type: 'path', path: 'total' }, format: 'currency', style: s({ textAlign: 'right', width: '18%' }) },
      ] },
      // Notes + Totals side-by-side
      { id: 'notes-totals-row', type: 'stack', direction: 'row', style: s({ gap: '24px', margin: '0 0 24px 0', alignItems: 'flex-start' }), children: [
        { id: 'notes-card', type: 'stack', direction: 'column', style: s({ flex: '1', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px', minHeight: '80px' }), children: [
          { id: 'notes-label', type: 'text', content: { type: 'literal', value: 'Notes' }, style: s({ fontWeight: 700, fontSize: '14px', margin: '0 0 6px 0' }) },
          { id: 'notes-text', type: 'text', content: { type: 'binding', bindingId: 'notes' }, style: s({ color: '#374151', lineHeight: 1.5 }) },
        ] },
        { id: 'totals', type: 'totals', style: s({ flex: '1', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px 12px', backgroundColor: '#f9fafb' }), sourceBinding: { bindingId: 'lineItems' }, rows: [
          { id: 'monthly-subtotal', label: 'Monthly', value: { type: 'binding', bindingId: 'recurringSubtotal' }, format: 'currency' },
          { id: 'monthly-tax', label: 'Tax', value: { type: 'binding', bindingId: 'recurringTax' }, format: 'currency' },
          { id: 'monthly-total', label: 'Monthly Total', value: { type: 'binding', bindingId: 'recurringTotal' }, format: 'currency', emphasize: true, style: s({ backgroundColor: '#7c45d3', color: '#ffffff', padding: '4px 6px', borderRadius: '4px', margin: '2px 0' }) },
          { id: 'onetime-subtotal', label: 'One-time', value: { type: 'binding', bindingId: 'onetimeSubtotal' }, format: 'currency' },
          { id: 'onetime-tax', label: 'Tax', value: { type: 'binding', bindingId: 'onetimeTax' }, format: 'currency' },
          { id: 'onetime-total', label: 'One-time Total', value: { type: 'binding', bindingId: 'onetimeTotal' }, format: 'currency', emphasize: true, style: s({ backgroundColor: '#7c45d3', color: '#ffffff', padding: '4px 6px', borderRadius: '4px', margin: '2px 0' }) },
        ] },
      ] },
    ],
  },
};

// ── Shared bindings for quote grouped template ──────────────────────────

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
    recurringSubtotal: { id: 'recurringSubtotal', kind: 'value', path: 'recurring_subtotal' },
    recurringTax: { id: 'recurringTax', kind: 'value', path: 'recurring_tax' },
    recurringTotal: { id: 'recurringTotal', kind: 'value', path: 'recurring_total' },
    onetimeSubtotal: { id: 'onetimeSubtotal', kind: 'value', path: 'onetime_subtotal' },
    onetimeTax: { id: 'onetimeTax', kind: 'value', path: 'onetime_tax' },
    onetimeTotal: { id: 'onetimeTotal', kind: 'value', path: 'onetime_total' },
  },
  collections: {
    lineItems: { id: 'lineItems', kind: 'collection', path: 'line_items' },
    phases: { id: 'phases', kind: 'collection', path: 'phases' },
    recurringItems: { id: 'recurringItems', kind: 'collection', path: 'recurring_items' },
    onetimeItems: { id: 'onetimeItems', kind: 'collection', path: 'onetime_items' },
  },
});

const quoteBindings = buildQuoteBindings();

const QUOTE_GROUPED_AST = {
  kind: 'invoice-template-ast',
  version: 1,
  metadata: { templateName: 'Standard Quote Grouped', printSettings: { paperPreset: 'Letter', marginMm: 10.58 } },
  bindings: quoteBindings,
  layout: {
    id: 'root', type: 'document',
    children: [
      // Header
      { id: 'header-top', type: 'stack', direction: 'row', style: s({ justifyContent: 'space-between', alignItems: 'flex-start', gap: '24px', margin: '0 0 20px 0' }), children: [
        { id: 'issuer-brand', type: 'stack', direction: 'column', style: s({ gap: '6px' }), children: [
          { id: 'issuer-logo', type: 'image', src: { type: 'binding', bindingId: 'tenantLogo' }, alt: { type: 'template', template: '{{name}} logo', args: { name: { type: 'binding', bindingId: 'tenantName' } } }, style: s({ width: '180px', maxHeight: '72px', margin: '0 0 6px 0' }) },
          { id: 'issuer-name', type: 'text', content: { type: 'binding', bindingId: 'tenantName' }, style: s({ fontSize: '18px', fontWeight: 700, lineHeight: 1.2 }) },
          { id: 'issuer-address', type: 'text', content: { type: 'binding', bindingId: 'tenantAddress' }, style: s({ color: '#4b5563', lineHeight: 1.4 }) },
        ] },
        { id: 'quote-meta-card', type: 'stack', direction: 'column', style: s({ minWidth: '280px', border: '1px solid #d1d5db', borderRadius: '10px', padding: '14px 16px', backgroundColor: '#f9fafb', gap: '6px' }), children: [
          { id: 'quote-title', type: 'text', content: { type: 'literal', value: 'ESTIMATE' }, style: s({ fontSize: '22px', fontWeight: 700, margin: '0 0 4px 0', lineHeight: 1.1 }) },
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
      // Monthly items
      { id: 'monthly-section-label', type: 'text', content: { type: 'literal', value: 'Monthly Items' }, style: s({ fontSize: '14px', fontWeight: 700, color: '#ffffff', backgroundColor: '#7c45d3', padding: '6px 12px', borderRadius: '6px 6px 0 0', margin: '0' }) },
      { id: 'monthly-items', type: 'dynamic-table', style: s({ margin: '0 0 16px 0', border: '1px solid #e5e7eb', borderRadius: '0 6px 6px 6px' }), headerStyle: s({ backgroundColor: '#7c45d3', color: '#ffffff' }), repeat: { sourceBinding: { bindingId: 'recurringItems' }, itemBinding: 'item' }, emptyStateText: 'No monthly items', columns: [
        { id: 'description', header: 'Description', value: { type: 'path', path: 'description' }, style: s({ width: '50%' }) },
        { id: 'unit-price', header: 'Price', value: { type: 'path', path: 'unit_price' }, format: 'currency', style: s({ textAlign: 'right', width: '18%' }) },
        { id: 'quantity', header: 'Qty', value: { type: 'path', path: 'quantity' }, format: 'number', style: s({ textAlign: 'right', width: '14%' }) },
        { id: 'amount', header: 'Amount', value: { type: 'path', path: 'total_price' }, format: 'currency', style: s({ textAlign: 'right', width: '18%' }) },
      ] },
      // One-time items
      { id: 'onetime-section-label', type: 'text', content: { type: 'literal', value: 'One-time Items' }, style: s({ fontSize: '14px', fontWeight: 700, color: '#ffffff', backgroundColor: '#7c45d3', padding: '6px 12px', borderRadius: '6px 6px 0 0', margin: '0' }) },
      { id: 'onetime-items', type: 'dynamic-table', style: s({ margin: '0 0 16px 0', border: '1px solid #e5e7eb', borderRadius: '0 6px 6px 6px' }), headerStyle: s({ backgroundColor: '#7c45d3', color: '#ffffff' }), repeat: { sourceBinding: { bindingId: 'onetimeItems' }, itemBinding: 'item' }, emptyStateText: 'No one-time items', columns: [
        { id: 'description', header: 'Description', value: { type: 'path', path: 'description' }, style: s({ width: '50%' }) },
        { id: 'unit-price', header: 'Price', value: { type: 'path', path: 'unit_price' }, format: 'currency', style: s({ textAlign: 'right', width: '18%' }) },
        { id: 'quantity', header: 'Qty', value: { type: 'path', path: 'quantity' }, format: 'number', style: s({ textAlign: 'right', width: '14%' }) },
        { id: 'amount', header: 'Amount', value: { type: 'path', path: 'total_price' }, format: 'currency', style: s({ textAlign: 'right', width: '18%' }) },
      ] },
      // Notes + Totals
      { id: 'notes-totals-row', type: 'stack', direction: 'row', style: s({ gap: '24px', margin: '0 0 24px 0', alignItems: 'flex-start' }), children: [
        { id: 'notes-card', type: 'stack', direction: 'column', style: s({ flex: '1', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '12px 14px', minHeight: '80px' }), children: [
          { id: 'notes-label', type: 'text', content: { type: 'literal', value: 'Notes' }, style: s({ fontWeight: 700, fontSize: '14px', margin: '0 0 6px 0' }) },
          { id: 'client-notes-text', type: 'text', content: { type: 'binding', bindingId: 'clientNotes' }, style: s({ color: '#374151', lineHeight: 1.5 }) },
        ] },
        { id: 'totals', type: 'totals', style: s({ flex: '1', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '10px 12px', backgroundColor: '#f9fafb' }), sourceBinding: { bindingId: 'lineItems' }, rows: [
          { id: 'monthly-subtotal', label: 'Monthly', value: { type: 'binding', bindingId: 'recurringSubtotal' }, format: 'currency' },
          { id: 'monthly-tax', label: 'Tax', value: { type: 'binding', bindingId: 'recurringTax' }, format: 'currency' },
          { id: 'monthly-total', label: 'Monthly Total', value: { type: 'binding', bindingId: 'recurringTotal' }, format: 'currency', emphasize: true, style: s({ backgroundColor: '#7c45d3', color: '#ffffff', padding: '4px 6px', borderRadius: '4px', margin: '2px 0' }) },
          { id: 'onetime-subtotal', label: 'One-time', value: { type: 'binding', bindingId: 'onetimeSubtotal' }, format: 'currency' },
          { id: 'onetime-tax', label: 'Tax', value: { type: 'binding', bindingId: 'onetimeTax' }, format: 'currency' },
          { id: 'onetime-total', label: 'One-time Total', value: { type: 'binding', bindingId: 'onetimeTotal' }, format: 'currency', emphasize: true, style: s({ backgroundColor: '#7c45d3', color: '#ffffff', padding: '4px 6px', borderRadius: '4px', margin: '2px 0' }) },
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
  // ── Invoice grouped template ──────────────────────────────────────
  const hasInvoiceTable = await knex.schema.hasTable(INVOICE_TABLE);
  if (hasInvoiceTable) {
    const hasAstCol = await knex.schema.hasColumn(INVOICE_TABLE, 'templateAst');
    if (hasAstCol) {
      const existing = await knex(INVOICE_TABLE)
        .where({ standard_invoice_template_code: 'standard-grouped' })
        .first();

      if (existing) {
        await knex(INVOICE_TABLE)
          .where({ standard_invoice_template_code: 'standard-grouped' })
          .update({
            name: 'Grouped Template',
            version: 1,
            templateAst: knex.raw('?::jsonb', [JSON.stringify(INVOICE_GROUPED_AST)]),
            updated_at: knex.fn.now(),
          });
      } else {
        await knex(INVOICE_TABLE).insert({
          template_id: knex.raw('gen_random_uuid()'),
          name: 'Grouped Template',
          version: 1,
          standard_invoice_template_code: 'standard-grouped',
          is_default: false,
          templateAst: knex.raw('?::jsonb', [JSON.stringify(INVOICE_GROUPED_AST)]),
          created_at: knex.fn.now(),
          updated_at: knex.fn.now(),
        });
      }
    }
  }

  // ── Quote grouped template ────────────────────────────────────────
  const hasQuoteTable = await knex.schema.hasTable(QUOTE_TABLE);
  if (hasQuoteTable) {
    await knex(QUOTE_TABLE)
      .insert({
        name: 'Grouped Quote Template',
        version: 1,
        standard_quote_document_template_code: 'standard-quote-grouped',
        templateAst: QUOTE_GROUPED_AST,
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
  }
};

exports.down = async function down(knex) {
  const hasInvoiceTable = await knex.schema.hasTable(INVOICE_TABLE);
  if (hasInvoiceTable) {
    await knex(INVOICE_TABLE)
      .where({ standard_invoice_template_code: 'standard-grouped' })
      .del();
  }

  const hasQuoteTable = await knex.schema.hasTable(QUOTE_TABLE);
  if (hasQuoteTable) {
    await knex(QUOTE_TABLE)
      .where({ standard_quote_document_template_code: 'standard-quote-grouped' })
      .del();
  }
};
