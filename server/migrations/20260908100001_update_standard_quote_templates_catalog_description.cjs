/**
 * Update managed standard quote templates so their line-item tables render the
 * item name above the catalog description in one stacked cell.
 *
 * Ticket 2354. Only the seeded standard templates (identified by code) are
 * touched. Tenant-owned custom quote templates and any standard row the code
 * no longer recognizes are left byte-for-byte unchanged.
 *
 * The change is additive and backward compatible: every matched column keeps
 * its legacy single `value` (the editable line `description`) as the cell
 * fallback and gains an optional `lines` array (item `service_name` above the
 * `catalog_description` snapshot). Rows without a catalog description render
 * the name line only; custom/discount/legacy rows fall back to their line text.
 */

const STANDARD_CODES = [
  'standard-quote-default',
  'standard-quote-detailed',
  'standard-quote-grouped',
  'standard-quote-by-location',
];

const ITEM_NAME_LINE = {
  id: 'item-name',
  value: { type: 'path', path: 'service_name' },
  style: { inline: { fontWeight: 600, lineHeight: 1.3 } },
};

const CATALOG_DESCRIPTION_LINE = {
  id: 'catalog-description',
  value: { type: 'path', path: 'catalog_description' },
  style: { inline: { color: '#4b5563', fontSize: '12px', lineHeight: 1.4 } },
};

function isDescriptionColumn(column) {
  return (
    column &&
    typeof column === 'object' &&
    column.id === 'description' &&
    column.value &&
    column.value.type === 'path' &&
    column.value.path === 'description'
  );
}

function addStackedLinesToDescriptionColumns(node) {
  if (!node || typeof node !== 'object') {
    return;
  }

  if ((node.type === 'table' || node.type === 'dynamic-table') && Array.isArray(node.columns)) {
    node.columns = node.columns.map((column) => {
      if (isDescriptionColumn(column) && !Array.isArray(column.lines)) {
        return {
          ...column,
          lines: [ITEM_NAME_LINE, CATALOG_DESCRIPTION_LINE],
        };
      }
      return column;
    });
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        addStackedLinesToDescriptionColumns(entry);
      }
    } else if (value && typeof value === 'object') {
      addStackedLinesToDescriptionColumns(value);
    }
  }
}

exports.up = async function up(knex) {
  const rows = await knex('standard_quote_document_templates')
    .whereIn('standard_quote_document_template_code', STANDARD_CODES)
    .select('template_id', 'standard_quote_document_template_code', 'templateAst');

  for (const row of rows) {
    const ast = row.templateAst;
    if (!ast || typeof ast !== 'object' || !ast.layout) {
      continue;
    }

    addStackedLinesToDescriptionColumns(ast.layout);
    await knex('standard_quote_document_templates')
      .where({ template_id: row.template_id })
      .update({ templateAst: ast });
  }
};

exports.down = async function down(knex) {
  // Deliberately not implemented: reverting the managed standard templates to
  // their pre-2354 presentation would rewrite rows that may already have been
  // re-copied by tenants. Roll forward instead.
};
