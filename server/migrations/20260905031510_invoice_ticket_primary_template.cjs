// Standard catalog ASTs are persisted. Update only the built-in by-ticket layout;
// saved custom copies remain authored documents, including former detail sections.
exports.up = async function(knex) {
  const row = await knex('standard_invoice_templates').where({ standard_invoice_template_code: 'standard-invoice-by-ticket' }).first();
  if (!row) return;
  const ast = typeof row.templateAst === 'string' ? JSON.parse(row.templateAst) : row.templateAst;
  if (!ast?.layout) throw new Error('The by-ticket standard template has no canonical AST');
  ast.bindings.collections.ticketPresentationRows = { id: 'ticketPresentationRows', kind: 'collection', path: 'ticketPresentationRows' };
  const visit = (node) => {
    if (node.children) node.children = node.children.filter(child => !['line-items', 'billed-time-heading'].includes(child.id)).map(visit);
    if (node.id === 'ticket-time-summary') {
      node.repeat.sourceBinding.bindingId = 'ticketPresentationRows';
      for (const column of node.columns) {
        if (column.value.path === 'totalHours') { column.value.path = 'quantity'; column.header = { i18nKey: 'time.quantityHours', defaultValue: 'Qty / Hours' }; }
        if (column.value.path === 'totalAmount') column.value.path = 'amount';
      }
    }
    if (node.id === 'billed-time-portal-note') node.content = { type: 'i18n', i18nKey: 'time.breakdown', defaultValue: 'Contact your service provider for a billed-time breakdown.' };
    return node;
  };
  visit(ast.layout);
  if (!ast.layout.children.some(n => n.id === 'ticket-coverage-note')) {
    const index = ast.layout.children.findIndex(n => n.id === 'totals-wrap');
    ast.layout.children.splice(index < 0 ? ast.layout.children.length : index, 0, {
      id: 'ticket-coverage-note', type: 'text', content: { type: 'path', path: 'ticketCoverageNote' },
      style: { inline: { fontSize: '11px', margin: '0 0 12px 0' } },
    });
  }
  await knex('standard_invoice_templates').where({ standard_invoice_template_code: 'standard-invoice-by-ticket' }).update({ templateAst: JSON.stringify(ast) });
};
// Restoring duplicated charges and unsupported portal guidance is not a safe rollback.
exports.down = async function() {};
