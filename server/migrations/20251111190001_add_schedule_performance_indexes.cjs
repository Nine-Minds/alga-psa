/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add index for faster schedule entry queries by date range and tenant
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_schedule_entries_tenant_dates
    ON schedule_entries(tenant, scheduled_start, scheduled_end)
    WHERE original_entry_id IS NULL
  `);

  // Add index for appointment request queries
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_schedule_entries_work_item_type
    ON schedule_entries(tenant, work_item_type, scheduled_start)
  `);

  // Add index for schedule entry assignees lookup
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_schedule_entry_assignees_lookup
    ON schedule_entry_assignees(tenant, user_id, entry_id)
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_schedule_entries_tenant_dates`);
  await knex.raw(`DROP INDEX IF EXISTS idx_schedule_entries_work_item_type`);
  await knex.raw(`DROP INDEX IF EXISTS idx_schedule_entry_assignees_lookup`);
};
