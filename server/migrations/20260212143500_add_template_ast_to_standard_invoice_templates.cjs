exports.up = async function up(knex) {
  const tableName = 'standard_invoice_templates';
  const hasTable = await knex.schema.hasTable(tableName);
  if (!hasTable) {
    return;
  }

  const hasTemplateAst = await knex.schema.hasColumn(tableName, 'templateAst');
  if (!hasTemplateAst) {
    await knex.schema.alterTable(tableName, (table) => {
      table.jsonb('templateAst').nullable().comment('Canonical JSON AST for standard invoice templates.');
    });
  }
};

exports.down = async function down(knex) {
  const tableName = 'standard_invoice_templates';
  const hasTable = await knex.schema.hasTable(tableName);
  if (!hasTable) {
    return;
  }

  const hasTemplateAst = await knex.schema.hasColumn(tableName, 'templateAst');
  if (hasTemplateAst) {
    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn('templateAst');
    });
  }
};
