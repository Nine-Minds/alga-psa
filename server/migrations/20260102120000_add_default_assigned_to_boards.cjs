/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add the column
  await knex.schema.alterTable('boards', (table) => {
    table.uuid('default_assigned_to').nullable();
  });

  // Add foreign key constraint (separate statement for Citus compatibility)
  // Note: ON DELETE SET NULL is not supported in CitusDB, so cleanup is handled
  // at the application level in userActions.ts (deleteUser/updateUser)
  await knex.schema.alterTable('boards', (table) => {
    table.foreign(['tenant', 'default_assigned_to'])
      .references(['tenant', 'user_id'])
      .inTable('users');
  });

  // Add index for efficient lookups by default assignee
  await knex.schema.alterTable('boards', (table) => {
    table.index(['tenant', 'default_assigned_to'], 'boards_default_assignee_idx');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('boards', (table) => {
    table.dropIndex(['tenant', 'default_assigned_to'], 'boards_default_assignee_idx');
    table.dropForeign(['tenant', 'default_assigned_to']);
    table.dropColumn('default_assigned_to');
  });
};

// Citus requires ALTER TABLE with foreign key constraints to run outside a transaction block
exports.config = { transaction: false };
