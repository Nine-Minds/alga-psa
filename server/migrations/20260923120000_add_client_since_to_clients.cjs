/**
 * Add nullable client_since to clients.
 *
 * Tenure predates AlgaPSA for migrated clients: created_at is when the row was
 * written here, not when the relationship began. Null keeps the created_at
 * fallback, so nothing needs backfilling.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('clients');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('clients', 'client_since');
  if (hasColumn) return;

  await knex.schema.alterTable('clients', (table) => {
    table.date('client_since').nullable();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('clients');
  if (!hasTable) return;

  const hasColumn = await knex.schema.hasColumn('clients', 'client_since');
  if (!hasColumn) return;

  await knex.schema.alterTable('clients', (table) => {
    table.dropColumn('client_since');
  });
};
