/**
 * Add reports_to column to users.
 */
exports.up = async function up(knex) {
  const hasReportsTo = await knex.schema.hasColumn('users', 'reports_to');

  if (!hasReportsTo) {
    await knex.schema.alterTable('users', (table) => {
      table.uuid('reports_to').nullable();
      table.foreign(['tenant', 'reports_to']).references(['tenant', 'user_id']).inTable('users');
    });
  }
};

exports.down = async function down(knex) {
  const hasReportsTo = await knex.schema.hasColumn('users', 'reports_to');
  if (!hasReportsTo) {
    return;
  }

  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('reports_to');
  });
};
