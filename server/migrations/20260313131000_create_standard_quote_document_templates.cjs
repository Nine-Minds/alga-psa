const TABLE_NAME = 'standard_quote_document_templates';

const buildBindings = () => ({
  values: {
    quoteNumber: { id: 'quoteNumber', kind: 'value', path: 'quoteNumber' },
    quoteDate: { id: 'quoteDate', kind: 'value', path: 'quoteDate' },
    validUntil: { id: 'validUntil', kind: 'value', path: 'validUntil' },
    status: { id: 'status', kind: 'value', path: 'status' },
    scope: { id: 'scope', kind: 'value', path: 'scope' },
    termsAndConditions: { id: 'termsAndConditions', kind: 'value', path: 'termsAndConditions' },
    clientNotes: { id: 'clientNotes', kind: 'value', path: 'clientNotes' },
    subtotal: { id: 'subtotal', kind: 'value', path: 'subtotal' },
    discountTotal: { id: 'discountTotal', kind: 'value', path: 'discountTotal' },
    tax: { id: 'tax', kind: 'value', path: 'tax' },
    total: { id: 'total', kind: 'value', path: 'total' },
    customerName: { id: 'customerName', kind: 'value', path: 'customer.name', fallback: 'Customer' },
  },
  collections: {
    lineItems: { id: 'lineItems', kind: 'collection', path: 'lineItems' },
  },
});

const DEFAULT_AST = {
  kind: 'invoice-template-ast',
  version: 1,
  metadata: {
    templateName: 'Standard Quote Default',
  },
  bindings: buildBindings(),
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'quote-header',
        type: 'section',
        title: 'Quote',
        children: [
          { id: 'quote-number', type: 'field', label: 'Quote #', binding: { bindingId: 'quoteNumber' } },
          { id: 'quote-date', type: 'field', label: 'Quote Date', binding: { bindingId: 'quoteDate' }, format: 'date' },
          { id: 'valid-until', type: 'field', label: 'Valid Until', binding: { bindingId: 'validUntil' }, format: 'date' },
          { id: 'customer-name', type: 'field', label: 'Client', binding: { bindingId: 'customerName' } },
        ],
      },
      {
        id: 'scope-section',
        type: 'section',
        title: 'Scope of Work',
        children: [
          { id: 'scope-text', type: 'text', content: { type: 'binding', bindingId: 'scope' } },
        ],
      },
      {
        id: 'line-items',
        type: 'dynamic-table',
        repeat: {
          sourceBinding: { bindingId: 'lineItems' },
          itemBinding: 'item',
        },
        columns: [
          { id: 'description', header: 'Description', value: { type: 'path', path: 'description' } },
          { id: 'quantity', header: 'Qty', value: { type: 'path', path: 'quantity' }, format: 'number' },
          { id: 'unit-price', header: 'Rate', value: { type: 'path', path: 'unitPrice' }, format: 'currency' },
          { id: 'total', header: 'Amount', value: { type: 'path', path: 'total' }, format: 'currency' },
        ],
      },
      {
        id: 'totals',
        type: 'totals',
        sourceBinding: { bindingId: 'lineItems' },
        rows: [
          { id: 'subtotal', label: 'Subtotal', value: { type: 'binding', bindingId: 'subtotal' }, format: 'currency' },
          { id: 'discount-total', label: 'Discounts', value: { type: 'binding', bindingId: 'discountTotal' }, format: 'currency' },
          { id: 'tax', label: 'Tax', value: { type: 'binding', bindingId: 'tax' }, format: 'currency' },
          { id: 'grand-total', label: 'Total', value: { type: 'binding', bindingId: 'total' }, format: 'currency', emphasize: true },
        ],
      },
      {
        id: 'terms-section',
        type: 'section',
        title: 'Terms & Conditions',
        children: [
          { id: 'terms-text', type: 'text', content: { type: 'binding', bindingId: 'termsAndConditions' } },
        ],
      },
    ],
  },
};

const DETAILED_AST = {
  kind: 'invoice-template-ast',
  version: 1,
  metadata: {
    templateName: 'Standard Quote Detailed',
  },
  bindings: buildBindings(),
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'intro',
        type: 'stack',
        direction: 'column',
        children: [
          { id: 'quote-title', type: 'text', content: { type: 'literal', value: 'Pricing Proposal' } },
          { id: 'quote-number', type: 'field', label: 'Quote #', binding: { bindingId: 'quoteNumber' } },
          { id: 'quote-date', type: 'field', label: 'Issued', binding: { bindingId: 'quoteDate' }, format: 'date' },
          { id: 'quote-valid-until', type: 'field', label: 'Valid Until', binding: { bindingId: 'validUntil' }, format: 'date' },
          { id: 'quote-status', type: 'field', label: 'Status', binding: { bindingId: 'status' } },
        ],
      },
      {
        id: 'scope-section',
        type: 'section',
        title: 'Overview',
        children: [
          { id: 'scope-body', type: 'text', content: { type: 'binding', bindingId: 'scope' } },
          { id: 'notes-body', type: 'text', content: { type: 'binding', bindingId: 'clientNotes' } },
        ],
      },
      {
        id: 'line-items',
        type: 'dynamic-table',
        repeat: {
          sourceBinding: { bindingId: 'lineItems' },
          itemBinding: 'item',
        },
        columns: [
          { id: 'phase', header: 'Phase', value: { type: 'path', path: 'phase' } },
          { id: 'description', header: 'Description', value: { type: 'path', path: 'description' } },
          { id: 'optional', header: 'Optional', value: { type: 'path', path: 'isOptional' } },
          { id: 'recurring', header: 'Recurring', value: { type: 'path', path: 'isRecurring' } },
          { id: 'quantity', header: 'Qty', value: { type: 'path', path: 'quantity' }, format: 'number' },
          { id: 'unit-price', header: 'Rate', value: { type: 'path', path: 'unitPrice' }, format: 'currency' },
          { id: 'total', header: 'Amount', value: { type: 'path', path: 'total' }, format: 'currency' },
        ],
      },
      {
        id: 'totals',
        type: 'totals',
        sourceBinding: { bindingId: 'lineItems' },
        rows: [
          { id: 'subtotal', label: 'Subtotal', value: { type: 'binding', bindingId: 'subtotal' }, format: 'currency' },
          { id: 'discount-total', label: 'Discounts', value: { type: 'binding', bindingId: 'discountTotal' }, format: 'currency' },
          { id: 'tax', label: 'Tax', value: { type: 'binding', bindingId: 'tax' }, format: 'currency' },
          { id: 'grand-total', label: 'Total', value: { type: 'binding', bindingId: 'total' }, format: 'currency', emphasize: true },
        ],
      },
      {
        id: 'terms-section',
        type: 'section',
        title: 'Terms & Conditions',
        children: [
          { id: 'terms-text', type: 'text', content: { type: 'binding', bindingId: 'termsAndConditions' } },
        ],
      },
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
      templateAst: knex.raw('EXCLUDED.templateAst'),
      is_default: knex.raw('EXCLUDED.is_default'),
      updated_at: knex.fn.now(),
    });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE_NAME);
};
