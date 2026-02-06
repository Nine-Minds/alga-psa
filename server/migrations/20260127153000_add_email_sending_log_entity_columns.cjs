/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('email_sending_logs', (table) => {
    table.string('entity_type', 50).nullable();
    table.uuid('entity_id').nullable();
    table.uuid('contact_id').nullable();
    table.integer('notification_subtype_id').nullable();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('email_sending_logs', (table) => {
    table.dropColumn('notification_subtype_id');
    table.dropColumn('contact_id');
    table.dropColumn('entity_id');
    table.dropColumn('entity_type');
  });
};

