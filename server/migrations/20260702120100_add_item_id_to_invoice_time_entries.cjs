/**
 * Persist invoice charge item linkage for time-entry charges.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const hasItemId = await knex.schema.hasColumn('invoice_time_entries', 'item_id');
  if (!hasItemId) {
    await knex.schema.alterTable('invoice_time_entries', function(table) {
      table.uuid('item_id').nullable();
    });
  }

  await knex.schema.raw(`
    CREATE INDEX IF NOT EXISTS invoice_time_entries_tenant_item_id_idx
    ON invoice_time_entries (tenant, item_id)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.raw('DROP INDEX IF EXISTS invoice_time_entries_tenant_item_id_idx');

  const hasItemId = await knex.schema.hasColumn('invoice_time_entries', 'item_id');
  if (hasItemId) {
    await knex.schema.alterTable('invoice_time_entries', function(table) {
      table.dropColumn('item_id');
    });
  }
};
