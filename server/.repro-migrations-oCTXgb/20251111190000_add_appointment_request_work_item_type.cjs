/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Drop the existing constraint
  await knex.raw(`
    ALTER TABLE schedule_entries
    DROP CONSTRAINT IF EXISTS schedule_entries_work_item_type_check
  `);

  // Add the constraint with appointment_request included
  await knex.raw(`
    ALTER TABLE schedule_entries
    ADD CONSTRAINT schedule_entries_work_item_type_check
    CHECK (work_item_type IN ('project_task', 'ticket', 'interaction', 'ad_hoc', 'appointment_request'))
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop the constraint
  await knex.raw(`
    ALTER TABLE schedule_entries
    DROP CONSTRAINT IF EXISTS schedule_entries_work_item_type_check
  `);

  // Restore to previous constraint without appointment_request
  await knex.raw(`
    ALTER TABLE schedule_entries
    ADD CONSTRAINT schedule_entries_work_item_type_check
    CHECK (work_item_type IN ('project_task', 'ticket', 'interaction', 'ad_hoc'))
  `);
};
