exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('users', 'client_portal_entra_metadata');
  if (!hasColumn) {
    await knex.schema.alterTable('users', (table) => {
      table.jsonb('client_portal_entra_metadata').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('users', 'client_portal_entra_metadata');
  if (hasColumn) {
    await knex.schema.alterTable('users', (table) => {
      table.dropColumn('client_portal_entra_metadata');
    });
  }
};
