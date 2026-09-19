/**
 * Add role column to team_members.
 */
exports.up = async function up(knex) {
  const hasRole = await knex.schema.hasColumn('team_members', 'role');
  if (!hasRole) {
    await knex.schema.alterTable('team_members', (table) => {
      table.text('role').notNullable().defaultTo('member');
    });
  }
};

exports.down = async function down(knex) {
  const hasRole = await knex.schema.hasColumn('team_members', 'role');
  if (!hasRole) {
    return;
  }

  await knex.schema.alterTable('team_members', (table) => {
    table.dropColumn('role');
  });
};
