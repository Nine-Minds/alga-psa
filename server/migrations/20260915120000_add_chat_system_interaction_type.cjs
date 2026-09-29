/**
 * Adds the `Chat` system interaction type that 3CX live-chat journaling files
 * under, following the Online Meeting migration.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasSystemTypes = await knex.schema.hasTable('system_interaction_types');
  if (!hasSystemTypes) {
    console.log('system_interaction_types table does not exist, skipping Chat interaction type');
    return;
  }

  const existing = await knex('system_interaction_types')
    .where('type_name', 'Chat')
    .first();

  if (!existing) {
    await knex('system_interaction_types').insert({
      type_name: 'Chat',
      icon: 'message-square',
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
    .where('type_name', 'Chat')
    .delete();
};
