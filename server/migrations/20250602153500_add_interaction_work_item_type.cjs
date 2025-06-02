/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add constraint to time_entries (currently missing)
  await knex.raw(`
    ALTER TABLE time_entries 
    ADD CONSTRAINT time_entries_work_item_type_check 
    CHECK (work_item_type IN ('ticket', 'project_task', 'non_billable_category', 'ad_hoc', 'interaction'))
  `);
  
  // Update schedule_entries constraint to include interaction
  await knex.raw(`
    ALTER TABLE schedule_entries
    DROP CONSTRAINT IF EXISTS schedule_entries_work_item_type_check
  `);
  
  await knex.raw(`
    ALTER TABLE schedule_entries
    ADD CONSTRAINT schedule_entries_work_item_type_check
    CHECK (work_item_type IN ('project_task', 'ticket', 'interaction', 'ad_hoc'))
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Remove constraint from time_entries
  await knex.raw(`
    ALTER TABLE time_entries 
    DROP CONSTRAINT IF EXISTS time_entries_work_item_type_check
  `);
  
  // Restore original schedule_entries constraint
  await knex.raw(`
    ALTER TABLE schedule_entries
    DROP CONSTRAINT IF EXISTS schedule_entries_work_item_type_check
  `);
  
  await knex.raw(`
    ALTER TABLE schedule_entries
    ADD CONSTRAINT schedule_entries_work_item_type_check
    CHECK (work_item_type IN ('project_task', 'ticket'))
  `);
};