exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('comments', 'metadata');
  if (!hasColumn) {
    await knex.schema.alterTable('comments', (table) => {
      table.jsonb('metadata').nullable();
    });
  }
};

exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('comments', 'metadata');
  if (hasColumn) {
    await knex.schema.alterTable('comments', (table) => {
      table.dropColumn('metadata');
    });
  }
};
