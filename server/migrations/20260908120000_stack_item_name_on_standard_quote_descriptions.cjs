// alga-2026-0002354 — quote lines now carry the catalog description, with the
// catalog name kept separately on `service_name`. The standard quote templates
// render from these global DB rows (seeded once, never resynced from TS), so
// the Description cell has to be patched here too or the name never prints.
//
// Idempotent: only a column still bound straight to `description` is rewritten
// to the stacked name-over-description expression. Tenant-authored templates in
// `quote_document_templates` are deliberately left alone.

const TABLE = 'standard_quote_document_templates';

const STACKED_DESCRIPTION_VALUE = {
  type: 'template',
  template: '{{name}}\n{{description}}',
  args: {
    name: { type: 'path', path: 'service_name' },
    description: { type: 'path', path: 'description' },
  },
};

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const isPlainDescriptionBinding = (value) =>
  isRecord(value) && value.type === 'path' && value.path === 'description';

// Recursively rewrite every `description` table column. Mutates in place;
// returns true when something changed.
function patchDescriptionColumns(node) {
  if (!node || typeof node !== 'object') {
    return false;
  }

  let changed = false;

  if (Array.isArray(node)) {
    for (const item of node) {
      if (patchDescriptionColumns(item)) {
        changed = true;
      }
    }
    return changed;
  }

  if (Array.isArray(node.columns)) {
    for (const column of node.columns) {
      if (isRecord(column) && column.id === 'description' && isPlainDescriptionBinding(column.value)) {
        column.value = JSON.parse(JSON.stringify(STACKED_DESCRIPTION_VALUE));
        changed = true;
      }
    }
  }

  for (const key of Object.keys(node)) {
    if (patchDescriptionColumns(node[key])) {
      changed = true;
    }
  }

  return changed;
}

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable(TABLE);
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn(TABLE, 'templateAst');
  if (!hasColumn) return;

  const rows = await knex(TABLE).select('template_id', 'templateAst');

  for (const row of rows) {
    if (!row.templateAst) continue;

    // JSONB arrives parsed; only the defensive string case needs parsing.
    const ast = typeof row.templateAst === 'string' ? JSON.parse(row.templateAst) : row.templateAst;

    if (patchDescriptionColumns(ast)) {
      await knex(TABLE)
        .where({ template_id: row.template_id })
        .update({ templateAst: JSON.stringify(ast), updated_at: knex.fn.now() });
    }
  }
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable(TABLE);
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn(TABLE, 'templateAst');
  if (!hasColumn) return;

  const rows = await knex(TABLE).select('template_id', 'templateAst');

  for (const row of rows) {
    if (!row.templateAst) continue;

    const ast = typeof row.templateAst === 'string' ? JSON.parse(row.templateAst) : row.templateAst;
    let changed = false;

    const revert = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(revert);
        return;
      }
      if (Array.isArray(node.columns)) {
        for (const column of node.columns) {
          if (
            isRecord(column) &&
            column.id === 'description' &&
            isRecord(column.value) &&
            column.value.type === 'template' &&
            column.value.template === STACKED_DESCRIPTION_VALUE.template
          ) {
            column.value = { type: 'path', path: 'description' };
            changed = true;
          }
        }
      }
      Object.keys(node).forEach((key) => revert(node[key]));
    };

    revert(ast);

    if (changed) {
      await knex(TABLE)
        .where({ template_id: row.template_id })
        .update({ templateAst: JSON.stringify(ast), updated_at: knex.fn.now() });
    }
  }
};
