/**
 * Refresh the standard document template catalog so its labels are key
 * references rather than English literals.
 *
 * Display strings in the catalog become `{ i18nKey, defaultValue }`, which the
 * renderer resolves against the recipient's locale. The English `defaultValue`
 * is carried on every reference, so a row that has been refreshed renders
 * exactly as before when no translation applies.
 *
 * Only the shared standard catalogs are touched — `standard_invoice_templates`
 * and `standard_quote_document_templates`. Tenant-owned tables
 * (`invoice_templates`, `document_templates`, tenant quote templates) are
 * deliberately left alone: a tenant who customized a template keeps exactly
 * what they authored, in the language they authored it.
 *
 * Idempotent: a value that is already a key reference is left as is, and only
 * display fields are walked. Node ids, binding ids, transform ids, column ids
 * and paths are machine identifiers and are never rewritten.
 */

const TARGETS = [
  { table: 'standard_invoice_templates', codeColumn: 'standard_invoice_template_code' },
  { table: 'standard_quote_document_templates', codeColumn: 'standard_quote_document_template_code' },
];

// English display string -> key in the `documents` namespace. Mirrors
// packages/billing/src/lib/**/standardTemplates.ts.
const LABEL_KEYS = {
  'Invoice #': 'labels.invoiceNumber',
  'Issue Date': 'labels.issueDate',
  'Due Date': 'labels.dueDate',
  Subtotal: 'labels.subtotal',
  Tax: 'labels.tax',
  Total: 'labels.total',
  'PO #': 'labels.poNumber',
  Monthly: 'labels.monthly',
  'Monthly Total': 'labels.monthlyTotal',
  'One-time': 'labels.oneTime',
  'One-time Total': 'labels.oneTimeTotal',
  'Quote #': 'labels.quoteNumber',
  Date: 'labels.date',
  'Valid Until': 'labels.validUntil',
  Discounts: 'labels.discounts',
  Version: 'labels.version',
  'Order #': 'labels.orderNumber',
  'Order Date': 'labels.orderDate',
  'Expected Ship': 'labels.expectedShip',
  'Your PO #': 'labels.yourPoNumber',
  'Order Total': 'labels.orderTotal',
  'Ship Date': 'labels.shipDate',
  Description: 'labels.description',
  Qty: 'labels.qty',
  Rate: 'labels.rate',
  Amount: 'labels.amount',
  Price: 'labels.price',
  'Project Phase': 'labels.projectPhase',
  Phase: 'labels.phase',
  Optional: 'labels.optional',
  Recurring: 'labels.recurring',
  Product: 'labels.product',
  SKU: 'labels.sku',
  'Unit Price': 'labels.unitPrice',
  Fulfillment: 'labels.fulfillment',
  Ordered: 'labels.ordered',
  Fulfilled: 'labels.fulfilled',
  Source: 'labels.source',
  Shipped: 'labels.shipped',
  Picked: 'labels.picked',
  Invoice: 'labels.invoice',
  Notes: 'labels.notes',
  'Terms & Conditions': 'labels.termsAndConditions',
  INVOICE: 'labels.invoiceTitle',
  From: 'labels.from',
  'Bill To': 'labels.billTo',
  'Monthly Items': 'labels.monthlyItems',
  'One-time Items': 'labels.oneTimeItems',
  'Location Subtotal': 'labels.locationSubtotal',
  QUOTE: 'labels.quoteTitle',
  'Prepared For': 'labels.preparedFor',
  'Accepted By': 'labels.acceptedBy',
  'Authorized By': 'labels.authorizedBy',
  Signature: 'labels.signature',
  ESTIMATE: 'labels.estimateTitle',
  'ORDER CONFIRMATION': 'labels.orderConfirmationTitle',
  'Ship To': 'labels.shipTo',
  'PACKING SLIP': 'labels.packingSlipTitle',
  'PICK LIST': 'labels.pickListTitle',
  'No billable line items': 'labels.emptyState.noBillableLineItems',
  'No monthly items': 'labels.emptyState.noMonthlyItems',
  'No one-time items': 'labels.emptyState.noOneTimeItems',
  'No line items': 'labels.emptyState.noLineItems',
  'No phases defined': 'labels.emptyState.noPhasesDefined',
  'No items on this order': 'labels.emptyState.noItemsOnOrder',
  'No items to pick': 'labels.emptyState.noItemsToPick',
  'Totals shown are pre-tax. Applicable tax is calculated on your invoice.': 'labels.note.preTaxTotals',
  'Thank you for your order.': 'labels.note.thankYouForOrder',
  'Picked by: ____________________     Date: ____________': 'labels.note.pickedBy',
};

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const localizeText = (value) => {
  if (typeof value !== 'string') return value;
  const key = LABEL_KEYS[value];
  return key ? { i18nKey: key, defaultValue: value } : value;
};

const localizeContent = (expression) => {
  if (!isRecord(expression) || expression.type !== 'literal' || typeof expression.value !== 'string') {
    return expression;
  }
  const key = LABEL_KEYS[expression.value];
  return key ? { type: 'i18n', i18nKey: key, defaultValue: expression.value } : expression;
};

const localizeColumns = (columns) =>
  Array.isArray(columns)
    ? columns.map((column) =>
        isRecord(column) && 'header' in column ? { ...column, header: localizeText(column.header) } : column
      )
    : columns;

function localizeNode(node) {
  if (!isRecord(node)) return node;

  const next = { ...node };

  if (Array.isArray(node.children)) {
    next.children = node.children.map(localizeNode);
  }

  switch (node.type) {
    case 'section':
      if ('title' in node) next.title = localizeText(node.title);
      break;
    case 'text':
      next.content = localizeContent(node.content);
      break;
    case 'field':
      if ('label' in node) next.label = localizeText(node.label);
      break;
    case 'table':
    case 'dynamic-table':
      next.columns = localizeColumns(node.columns);
      if ('emptyStateText' in node) next.emptyStateText = localizeText(node.emptyStateText);
      break;
    case 'totals':
      if (Array.isArray(node.rows)) {
        next.rows = node.rows.map((row) =>
          isRecord(row) ? { ...row, label: localizeText(row.label) } : row
        );
      }
      break;
    default:
      break;
  }

  return next;
}

const localizeAst = (ast) => (isRecord(ast) && isRecord(ast.layout) ? { ...ast, layout: localizeNode(ast.layout) } : ast);

exports.up = async function up(knex) {
  for (const { table, codeColumn } of TARGETS) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, 'templateAst'))) continue;

    const rows = await knex(table).select('template_id', codeColumn, 'templateAst');

    for (const row of rows) {
      // Never touch a row that is not part of the shipped catalog.
      if (!row[codeColumn]) continue;

      const ast = typeof row.templateAst === 'string' ? JSON.parse(row.templateAst) : row.templateAst;
      if (!isRecord(ast)) continue;

      const localized = localizeAst(ast);
      if (JSON.stringify(localized) === JSON.stringify(ast)) continue;

      await knex(table)
        .where({ template_id: row.template_id })
        .update({
          templateAst: knex.raw('?::jsonb', [JSON.stringify(localized)]),
          updated_at: knex.fn.now(),
        });
    }
  }
};

exports.down = async function down() {
  // No-op: this refreshes live catalog data and should not be auto-reverted.
  // Every key reference carries its English default, so the rendered output is
  // unchanged for an English recipient either way.
};
