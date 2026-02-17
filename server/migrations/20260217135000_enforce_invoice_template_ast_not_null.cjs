/**
 * Enforce strict AST-only template storage.
 *
 * Preconditions:
 * - All template rows have canonical templateAst
 * - Custom assignment references are valid
 */

const INVOICE_TEMPLATES_TABLE = 'invoice_templates';
const STANDARD_TEMPLATES_TABLE = 'standard_invoice_templates';
const ASSIGNMENTS_TABLE = 'invoice_template_assignments';
const STANDARD_DEFAULT_CODE = 'standard-default';
const STANDARD_DETAILED_CODE = 'standard-detailed';

// Distributed-table ALTERs in Citus need shard-aware handling and should not run in a transaction wrapper.
exports.config = { transaction: false };

async function isColumnNullable(knex, tableName, columnName) {
  const row = await knex('information_schema.columns')
    .select('is_nullable')
    .where({
      table_schema: 'public',
      table_name: tableName,
      column_name: columnName,
    })
    .first();

  return row?.is_nullable === 'YES';
}

async function setColumnNullability(knex, tableName, columnName, nullable) {
  if (nullable) {
    await knex.raw('ALTER TABLE ?? ALTER COLUMN ?? DROP NOT NULL', [tableName, columnName]);
    return;
  }

  await knex.raw('ALTER TABLE ?? ALTER COLUMN ?? SET NOT NULL', [tableName, columnName]);
}

async function assertNoMissingAst(knex, tableName) {
  const result = await knex(tableName)
    .whereNull('templateAst')
    .count('* as count')
    .first();
  const count = Number(result?.count || 0);
  if (count > 0) {
    throw new Error(
      `[invoice-ast-cutover] ${tableName} has ${count} row(s) with NULL templateAst; run data normalization first.`
    );
  }
}

const buildFallbackBindings = () => ({
  values: {
    invoiceNumber: { id: 'invoiceNumber', kind: 'value', path: 'invoiceNumber' },
    issueDate: { id: 'issueDate', kind: 'value', path: 'issueDate' },
    dueDate: { id: 'dueDate', kind: 'value', path: 'dueDate' },
    poNumber: { id: 'poNumber', kind: 'value', path: 'poNumber' },
    subtotal: { id: 'subtotal', kind: 'value', path: 'subtotal' },
    tax: { id: 'tax', kind: 'value', path: 'tax' },
    total: { id: 'total', kind: 'value', path: 'total' },
    tenantClientName: {
      id: 'tenantClientName',
      kind: 'value',
      path: 'tenantClient.name',
      fallback: 'Your Company',
    },
    tenantClientAddress: {
      id: 'tenantClientAddress',
      kind: 'value',
      path: 'tenantClient.address',
      fallback: 'Company address',
    },
    customerName: { id: 'customerName', kind: 'value', path: 'customer.name', fallback: 'Customer' },
    customerAddress: {
      id: 'customerAddress',
      kind: 'value',
      path: 'customer.address',
      fallback: 'Customer address',
    },
  },
  collections: {
    lineItems: { id: 'lineItems', kind: 'collection', path: 'items' },
  },
});

const buildFallbackStandardAst = (templateName) => ({
  kind: 'invoice-template-ast',
  version: 1,
  metadata: {
    templateName,
  },
  bindings: buildFallbackBindings(),
  layout: {
    id: 'root',
    type: 'document',
    children: [
      {
        id: 'header',
        type: 'section',
        title: 'Invoice',
        children: [
          {
            id: 'invoice-number',
            type: 'field',
            label: 'Invoice #',
            binding: { bindingId: 'invoiceNumber' },
          },
          {
            id: 'issue-date',
            type: 'field',
            label: 'Issue Date',
            binding: { bindingId: 'issueDate' },
            format: 'date',
          },
          {
            id: 'due-date',
            type: 'field',
            label: 'Due Date',
            binding: { bindingId: 'dueDate' },
            format: 'date',
          },
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
          {
            id: 'description',
            header: 'Description',
            value: { type: 'path', path: 'description' },
          },
          {
            id: 'quantity',
            header: 'Qty',
            value: { type: 'path', path: 'quantity' },
            format: 'number',
            style: { inline: { textAlign: 'right' } },
          },
          {
            id: 'unit-price',
            header: 'Rate',
            value: { type: 'path', path: 'unitPrice' },
            format: 'currency',
            style: { inline: { textAlign: 'right' } },
          },
          {
            id: 'line-total',
            header: 'Amount',
            value: { type: 'path', path: 'total' },
            format: 'currency',
            style: { inline: { textAlign: 'right' } },
          },
        ],
      },
      {
        id: 'totals',
        type: 'totals',
        sourceBinding: { bindingId: 'lineItems' },
        rows: [
          {
            id: 'subtotal',
            label: 'Subtotal',
            value: { type: 'binding', bindingId: 'subtotal' },
            format: 'currency',
          },
          { id: 'tax', label: 'Tax', value: { type: 'binding', bindingId: 'tax' }, format: 'currency' },
          {
            id: 'total',
            label: 'Total',
            value: { type: 'binding', bindingId: 'total' },
            format: 'currency',
            emphasize: true,
          },
        ],
      },
    ],
  },
});

async function getExistingStandardAst(knex, desiredCode) {
  let row = await knex(STANDARD_TEMPLATES_TABLE)
    .select('templateAst')
    .whereNotNull('templateAst')
    .where({ standard_invoice_template_code: desiredCode })
    .first();

  if (row?.templateAst) {
    return row.templateAst;
  }

  if (desiredCode === STANDARD_DETAILED_CODE) {
    row = await knex(STANDARD_TEMPLATES_TABLE)
      .select('templateAst')
      .whereNotNull('templateAst')
      .whereRaw('lower(name) like ?', ['%detailed%'])
      .first();
    if (row?.templateAst) {
      return row.templateAst;
    }
  }

  row = await knex(STANDARD_TEMPLATES_TABLE)
    .select('templateAst')
    .whereNotNull('templateAst')
    .first();

  return row?.templateAst || null;
}

async function normalizeStandardTemplateAst(knex) {
  const defaultAst =
    (await getExistingStandardAst(knex, STANDARD_DEFAULT_CODE)) ||
    buildFallbackStandardAst('Standard Template');
  const detailedAst =
    (await getExistingStandardAst(knex, STANDARD_DETAILED_CODE)) ||
    buildFallbackStandardAst('Detailed Template');

  const defaultAstJson = JSON.stringify(defaultAst);
  const detailedAstJson = JSON.stringify(detailedAst);

  // Set every row explicitly to avoid NULL three-valued logic gaps in WHERE/WHERE NOT expressions.
  await knex.raw(
    `UPDATE ??
     SET "templateAst" = CASE
       WHEN lower(COALESCE("standard_invoice_template_code", '')) = ?
         OR lower(COALESCE("name", '')) LIKE ?
       THEN ?::jsonb
       ELSE ?::jsonb
     END`,
    [STANDARD_TEMPLATES_TABLE, STANDARD_DETAILED_CODE, '%detailed%', detailedAstJson, defaultAstJson]
  );
}

async function assertNoDanglingCustomAssignments(knex) {
  const tenantRows = await knex(ASSIGNMENTS_TABLE)
    .distinct('tenant')
    .where({ template_source: 'custom' });

  let danglingCount = 0;

  for (const row of tenantRows) {
    const tenant = row.tenant;
    const templateRows = await knex(INVOICE_TEMPLATES_TABLE)
      .select('template_id')
      .where({ tenant });
    const validTemplateIds = new Set(templateRows.map((template) => String(template.template_id)));

    const assignmentRows = await knex(ASSIGNMENTS_TABLE)
      .select('invoice_template_id')
      .where({ tenant, template_source: 'custom' });

    for (const assignment of assignmentRows) {
      const assignmentTemplateId = assignment.invoice_template_id ? String(assignment.invoice_template_id) : null;
      if (!assignmentTemplateId || !validTemplateIds.has(assignmentTemplateId)) {
        danglingCount += 1;
      }
    }
  }

  if (danglingCount > 0) {
    throw new Error(
      `[invoice-ast-cutover] ${danglingCount} custom assignment(s) point to missing invoice_templates rows.`
    );
  }
}

exports.up = async function up(knex) {
  const hasInvoiceTemplates = await knex.schema.hasTable(INVOICE_TEMPLATES_TABLE);
  const hasStandardTemplates = await knex.schema.hasTable(STANDARD_TEMPLATES_TABLE);
  const hasAssignments = await knex.schema.hasTable(ASSIGNMENTS_TABLE);

  if (!hasInvoiceTemplates || !hasStandardTemplates) {
    return;
  }

  await normalizeStandardTemplateAst(knex);

  await assertNoMissingAst(knex, INVOICE_TEMPLATES_TABLE);
  await assertNoMissingAst(knex, STANDARD_TEMPLATES_TABLE);

  if (hasAssignments) {
    await assertNoDanglingCustomAssignments(knex);
  }

  const invoiceTemplateAstIsNullable = await isColumnNullable(knex, INVOICE_TEMPLATES_TABLE, 'templateAst');
  if (invoiceTemplateAstIsNullable) {
    await setColumnNullability(knex, INVOICE_TEMPLATES_TABLE, 'templateAst', false);
  }

  const standardTemplateAstIsNullable = await isColumnNullable(knex, STANDARD_TEMPLATES_TABLE, 'templateAst');
  if (standardTemplateAstIsNullable) {
    await setColumnNullability(knex, STANDARD_TEMPLATES_TABLE, 'templateAst', false);
  }
};

exports.down = async function down(knex) {
  const hasInvoiceTemplates = await knex.schema.hasTable(INVOICE_TEMPLATES_TABLE);
  const hasStandardTemplates = await knex.schema.hasTable(STANDARD_TEMPLATES_TABLE);

  if (hasInvoiceTemplates) {
    await setColumnNullability(knex, INVOICE_TEMPLATES_TABLE, 'templateAst', true);
  }

  if (hasStandardTemplates) {
    await setColumnNullability(knex, STANDARD_TEMPLATES_TABLE, 'templateAst', true);
  }
};
