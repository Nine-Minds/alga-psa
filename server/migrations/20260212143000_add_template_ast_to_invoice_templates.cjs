exports.up = async function up(knex) {
  const tableName = 'invoice_templates';
  const hasTemplateAst = await knex.schema.hasColumn(tableName, 'templateAst');

  if (!hasTemplateAst) {
    await knex.schema.alterTable(tableName, (table) => {
      table.jsonb('templateAst').nullable().comment('Canonical invoice template JSON AST payload.');
    });
  }
};

exports.down = async function down(knex) {
  const tableName = 'invoice_templates';
  const hasTemplateAst = await knex.schema.hasColumn(tableName, 'templateAst');

  if (hasTemplateAst) {
    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn('templateAst');
    });
  }
};
