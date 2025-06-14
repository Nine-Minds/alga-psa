/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Add 'internal_notification' to the item_type enum constraint
  await knex.raw(`
    ALTER TABLE standard_priorities 
    DROP CONSTRAINT IF EXISTS standard_priorities_item_type_check
  `);
  
  await knex.raw(`
    ALTER TABLE standard_priorities 
    ADD CONSTRAINT standard_priorities_item_type_check 
    CHECK (item_type IN ('ticket', 'project_task', 'internal_notification'))
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Remove internal_notification data first
  await knex('standard_priorities').where('item_type', 'internal_notification').del();
  
  // Revert back to original constraint
  await knex.raw(`
    ALTER TABLE standard_priorities 
    DROP CONSTRAINT IF EXISTS standard_priorities_item_type_check
  `);
  
  await knex.raw(`
    ALTER TABLE standard_priorities 
    ADD CONSTRAINT standard_priorities_item_type_check 
    CHECK (item_type IN ('ticket', 'project_task'))
  `);
};