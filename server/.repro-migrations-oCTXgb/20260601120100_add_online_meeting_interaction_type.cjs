/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasSystemTypes = await knex.schema.hasTable('system_interaction_types');
  if (!hasSystemTypes) {
    console.log('system_interaction_types table does not exist, skipping Online Meeting interaction type');
    return;
  }

  const existingOnlineMeeting = await knex('system_interaction_types')
    .where('type_name', 'Online Meeting')
    .first();

  if (!existingOnlineMeeting) {
    await knex('system_interaction_types').insert({
      type_name: 'Online Meeting',
      icon: 'video',
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasSystemTypes = await knex.schema.hasTable('system_interaction_types');
  if (!hasSystemTypes) {
    return;
  }

  await knex('system_interaction_types')
    .where('type_name', 'Online Meeting')
    .delete();
};
