const DEFINITIONS = {
  'monthly-section-label': {
    bindingId: 'recurringSectionTitle',
    i18nKey: 'labels.monthlyItems',
    defaultValue: 'Monthly Items',
  },
  'onetime-section-label': {
    bindingId: 'onetimeSectionTitle',
    i18nKey: 'labels.oneTimeItems',
    defaultValue: 'One-time Items',
  },
};

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

function transformNode(node, direction) {
  if (!isRecord(node)) return node;
  const next = { ...node };
  if (Array.isArray(node.children)) next.children = node.children.map((child) => transformNode(child, direction));

  const definition = DEFINITIONS[node.id];
  if (node.type === 'text' && definition) {
    const original = { type: 'i18n', i18nKey: definition.i18nKey, defaultValue: definition.defaultValue };
    const updated = {
      type: 'binding',
      bindingId: definition.bindingId,
      fallback: { i18nKey: definition.i18nKey, defaultValue: definition.defaultValue },
    };
    if (direction === 'up' && JSON.stringify(node.content) === JSON.stringify(original)) next.content = updated;
    if (direction === 'down' && JSON.stringify(node.content) === JSON.stringify(updated)) next.content = original;
  }
  return next;
}

const transformAst = (ast, direction) =>
  isRecord(ast) && isRecord(ast.layout) ? { ...ast, layout: transformNode(ast.layout, direction) } : ast;

async function updateCatalog(knex, direction) {
  const table = 'standard_quote_document_templates';
  if (!(await knex.schema.hasTable(table)) || !(await knex.schema.hasColumn(table, 'templateAst'))) return;

  // This is a global shipped catalog (no tenant shard key); select/transform/update
  // each row so the migration is Citus safe and never rewrites tenant-owned copies.
  const rows = await knex(table)
    .select('template_id', 'standard_quote_document_template_code', 'templateAst')
    .where('standard_quote_document_template_code', 'standard-quote-grouped');
  for (const row of rows) {
    const ast = typeof row.templateAst === 'string' ? JSON.parse(row.templateAst) : row.templateAst;
    const transformed = transformAst(ast, direction);
    if (JSON.stringify(transformed) === JSON.stringify(ast)) continue;
    await knex(table).where({ template_id: row.template_id }).update({
      templateAst: knex.raw('?::jsonb', [JSON.stringify(transformed)]),
      updated_at: knex.fn.now(),
    });
  }
}

exports.up = (knex) => updateCatalog(knex, 'up');
exports.down = (knex) => updateCatalog(knex, 'down');
exports.__transformAst = transformAst;
