// alga-2026-0002771: "Standard Invoice By Ticket" overflowed the page (Amount clipped, Ticket
// column unreadable). Give the built-in by-ticket summary table a fixed layout with explicit
// column widths and no-wrap numeric cells.
//
// Scope: ONLY the global `standard_invoice_templates` row `standard-invoice-by-ticket`.
// Tenant `invoice_templates` rows (clones made from the template UI) are authored documents
// and are deliberately not touched.
//
// Matching is structural, not a blanket overwrite: the row is updated only if it still
// contains the built-in `ticket-time-summary` dynamic-table with exactly the stock column
// ids (with or without the Service Period column added by 20261020000000).
// Re-running is a no-op (idempotent). Mirrors buildStandardByTicketAst in
// packages/billing/src/lib/invoice-template-ast/standardTemplates.ts.
const CODE = 'standard-invoice-by-ticket';
const TABLE_ID = 'ticket-time-summary';
const SERVICE_PERIOD_COLUMN = 'ticket-service-period';

const COLUMN_STYLES = {
  ticket: { width: '27%', overflowWrap: 'anywhere' },
  'ticket-description': { width: '33%', overflowWrap: 'anywhere', lineHeight: 1.35 },
  'ticket-hours': { textAlign: 'right', width: '14%', whiteSpace: 'nowrap' },
  'ticket-rate': { textAlign: 'right', width: '12%', whiteSpace: 'nowrap' },
  'ticket-amount': { textAlign: 'right', width: '14%', whiteSpace: 'nowrap' },
};

// 20261020000000 adds a Service Period column to the same table and rebalances the
// widths to make room for it. Whichever of the two migrations runs first, the row ends
// up with the widths of its shape (both still total 100%).
const COLUMN_STYLES_WITH_SERVICE_PERIOD = {
  ticket: { width: '20%', overflowWrap: 'anywhere' },
  'ticket-description': { width: '26%', overflowWrap: 'anywhere', lineHeight: 1.35 },
  [SERVICE_PERIOD_COLUMN]: { width: '18%' },
  'ticket-hours': { textAlign: 'right', width: '8%', whiteSpace: 'nowrap' },
  'ticket-rate': { textAlign: 'right', width: '13%', whiteSpace: 'nowrap' },
  'ticket-amount': { textAlign: 'right', width: '15%', whiteSpace: 'nowrap' },
};

const findNode = (node, id) => {
  if (!node || typeof node !== 'object') return null;
  if (node.id === id) return node;
  for (const child of Array.isArray(node.children) ? node.children : []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
};

exports.up = async function up(knex) {
  const row = await knex('standard_invoice_templates').where({ standard_invoice_template_code: CODE }).first();
  if (!row) {
    console.log(`[by-ticket-layout] no ${CODE} row; nothing to update`);
    return;
  }
  const ast = typeof row.templateAst === 'string' ? JSON.parse(row.templateAst) : row.templateAst;
  const table = findNode(ast?.layout, TABLE_ID);
  const columnIds = Array.isArray(table?.columns) ? table.columns.map((column) => column.id) : [];
  const styles = columnIds.includes(SERVICE_PERIOD_COLUMN) ? COLUMN_STYLES_WITH_SERVICE_PERIOD : COLUMN_STYLES;
  const isStock = table && table.type === 'dynamic-table'
    && columnIds.length === Object.keys(styles).length
    && Object.keys(styles).every((id) => columnIds.includes(id));
  if (!isStock) {
    console.log(`[by-ticket-layout] ${CODE} no longer has the stock ${TABLE_ID} table; skipped (0 updated, 1 skipped)`);
    return;
  }

  let changed = false;
  const setInline = (target, patch) => {
    target.style = target.style ?? {};
    target.style.inline = target.style.inline ?? {};
    for (const [key, value] of Object.entries(patch)) {
      if (target.style.inline[key] !== value) {
        target.style.inline[key] = value;
        changed = true;
      }
    }
  };
  setInline(table, { tableLayout: 'fixed' });
  for (const column of table.columns) setInline(column, styles[column.id]);

  if (!changed) {
    console.log(`[by-ticket-layout] ${CODE} already has the fixed layout (0 updated)`);
    return;
  }
  // migration-lint: allow 5 - retroactive: single-row UPDATE keyed by standard_invoice_template_code; merged before the lint existed
  await knex('standard_invoice_templates')
    .where({ standard_invoice_template_code: CODE })
    .update({ templateAst: JSON.stringify(ast) });
  console.log(`[by-ticket-layout] updated ${CODE}: ${TABLE_ID} tableLayout=fixed, widths ${Object.values(styles).map((s) => s.width).join('/')} (1 updated, 0 skipped)`);
};

// Restoring the overflowing layout is not a useful rollback.
exports.down = async function down() {};
