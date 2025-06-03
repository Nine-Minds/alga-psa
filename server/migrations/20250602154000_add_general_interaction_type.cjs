/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // First check if system_interaction_types table exists
  const hasSystemTypes = await knex.schema.hasTable('system_interaction_types');
  if (!hasSystemTypes) {
    console.log('system_interaction_types table does not exist, skipping migration');
    return;
  }

  // Check if 'General' already exists
  const existingGeneral = await knex('system_interaction_types')
    .where('type_name', 'General')
    .first();
  
  if (!existingGeneral) {
    // Add 'General' to system interaction types
    await knex('system_interaction_types').insert({
      type_name: 'General',
      icon: 'activity'
    });
  }
  
  // Note: Individual tenants can create their own 'General' interaction types
  // through the application UI when needed
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // First check if system_interaction_types table exists
  const hasSystemTypes = await knex.schema.hasTable('system_interaction_types');
  if (!hasSystemTypes) {
    return;
  }

  // Remove from system interaction types
  await knex('system_interaction_types')
    .where('type_name', 'General')
    .delete();
  
  // Note: This does not remove tenant-specific interaction types
  // as they are managed independently
};