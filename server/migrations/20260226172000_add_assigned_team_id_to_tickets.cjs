/**
 * Add assigned_team_id column to tickets.
 *
 * NOTE: tickets is distributed in Citus, so ALTER TABLE must run outside a transaction.
 */
exports.up = async function up(knex) {
  const hasAssignedTeam = await knex.schema.hasColumn('tickets', 'assigned_team_id');
  if (!hasAssignedTeam) {
    await knex.schema.alterTable('tickets', (table) => {
      table.uuid('assigned_team_id').nullable().references('team_id').inTable('teams');
    });
  }
};

exports.down = async function down(knex) {
  const hasAssignedTeam = await knex.schema.hasColumn('tickets', 'assigned_team_id');
  if (!hasAssignedTeam) {
    return;
  }

  await knex.schema.alterTable('tickets', (table) => {
    table.dropColumn('assigned_team_id');
  });
};

exports.config = { transaction: false };
