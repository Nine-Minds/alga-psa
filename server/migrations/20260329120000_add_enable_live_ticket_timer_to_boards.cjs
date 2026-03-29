/**
 * Add board-level live timer toggle for ticket details.
 *
 * Existing rows should preserve enabled behavior after rollout.
 * New rows default to enabled.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('boards', 'enable_live_ticket_timer');
  if (!hasColumn) {
    await knex.schema.alterTable('boards', (table) => {
      table.boolean('enable_live_ticket_timer').nullable().defaultTo(true);
    });
  }

  await knex('boards')
    .whereNull('enable_live_ticket_timer')
    .update({ enable_live_ticket_timer: true });

  await knex.schema.alterTable('boards', (table) => {
    table.boolean('enable_live_ticket_timer').notNullable().defaultTo(true).alter();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('boards', 'enable_live_ticket_timer');
  if (!hasColumn) return;

  await knex.schema.alterTable('boards', (table) => {
    table.dropColumn('enable_live_ticket_timer');
  });
};
