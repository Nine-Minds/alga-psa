/**
 * Add support for ad-hoc schedule entries
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // First, make work_item_id nullable
  await knex.schema.alterTable('schedule_entries', table => {
    table.uuid('work_item_id').alter().nullable();
  });

  // Then update the work_item_type check constraint
  await knex.raw(`
    ALTER TABLE schedule_entries 
    DROP CONSTRAINT IF EXISTS schedule_entries_work_item_type_check;
  `);

  await knex.raw(`
    ALTER TABLE schedule_entries 
    ADD CONSTRAINT schedule_entries_work_item_type_check 
    CHECK (work_item_type = ANY (ARRAY['project_task'::text, 'ticket'::text, 'ad_hoc'::text]));
  `);
};

/**
 * Revert support for ad-hoc schedule entries
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // First, ensure no ad-hoc entries exist
  await knex('schedule_entries')
    .where({ work_item_type: 'ad_hoc' })
    .delete();

  // Then make work_item_id required again
  await knex.schema.alterTable('schedule_entries', table => {
    table.uuid('work_item_id').alter().notNullable();
  });

  // Finally, restore the original work_item_type check constraint
  await knex.raw(`
    ALTER TABLE schedule_entries 
    DROP CONSTRAINT IF EXISTS schedule_entries_work_item_type_check;
  `);

  await knex.raw(`
    ALTER TABLE schedule_entries 
    ADD CONSTRAINT schedule_entries_work_item_type_check 
    CHECK (work_item_type = ANY (ARRAY['project_task'::text, 'ticket'::text]));
  `);
};
