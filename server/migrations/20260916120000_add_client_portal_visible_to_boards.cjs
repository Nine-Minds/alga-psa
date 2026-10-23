/**
 * Board-level client portal visibility.
 *
 * A board with client_portal_visible = false is excluded from every client
 * portal surface (ticket creation picker, ticket lists, dashboards) for all
 * portal users, regardless of visibility group membership. Existing boards
 * stay visible.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('boards', 'client_portal_visible');
  if (hasColumn) return;

  await knex.schema.alterTable('boards', (table) => {
    table.boolean('client_portal_visible').notNullable().defaultTo(true);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('boards', 'client_portal_visible');
  if (!hasColumn) return;

  await knex.schema.alterTable('boards', (table) => {
    table.dropColumn('client_portal_visible');
  });
};
