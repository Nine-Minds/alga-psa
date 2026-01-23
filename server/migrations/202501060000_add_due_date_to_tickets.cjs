exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('tickets', 'due_date');
  if (!hasColumn) {
    await knex.schema.alterTable('tickets', function(table) {
      table.timestamp('due_date', { useTz: true }).nullable();
    });
  }
};

exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('tickets', 'due_date');
  if (hasColumn) {
    await knex.schema.alterTable('tickets', function(table) {
      table.dropColumn('due_date');
    });
  }
};
