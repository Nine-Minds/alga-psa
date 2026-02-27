/**
 * Add default_assigned_team_id column to boards.
 *
 * Allows boards to have a default team assignment alongside the default agent.
 * When a team is selected as default, the team's manager becomes the default agent.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('boards', 'default_assigned_team_id');
  if (hasColumn) return;

  // Add the column
  await knex.schema.alterTable('boards', (table) => {
    table.uuid('default_assigned_team_id').nullable();
  });

  // Add foreign key constraint (separate statement for Citus compatibility)
  await knex.schema.alterTable('boards', (table) => {
    table.foreign(['tenant', 'default_assigned_team_id'])
      .references(['tenant', 'team_id'])
      .inTable('teams');
  });

  // Add index for efficient lookups
  await knex.schema.alterTable('boards', (table) => {
    table.index(['tenant', 'default_assigned_team_id'], 'boards_default_assigned_team_idx');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('boards', 'default_assigned_team_id');
  if (!hasColumn) return;

  await knex.schema.alterTable('boards', (table) => {
    table.dropIndex(['tenant', 'default_assigned_team_id'], 'boards_default_assigned_team_idx');
    table.dropForeign(['tenant', 'default_assigned_team_id']);
    table.dropColumn('default_assigned_team_id');
  });
};

// Citus requires ALTER TABLE with foreign key constraints to run outside a transaction block
exports.config = { transaction: false };
