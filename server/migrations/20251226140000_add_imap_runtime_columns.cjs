/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('imap_email_provider_config', function(table) {
    table.text('last_processed_message_id').nullable();
    table.jsonb('server_capabilities').defaultTo('[]');
    table.string('lease_owner', 255).nullable();
    table.timestamp('lease_expires_at').nullable();
    table.integer('connection_timeout_ms').nullable();
    table.boolean('socket_keepalive').nullable();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.alterTable('imap_email_provider_config', function(table) {
    table.dropColumn('last_processed_message_id');
    table.dropColumn('server_capabilities');
    table.dropColumn('lease_owner');
    table.dropColumn('lease_expires_at');
    table.dropColumn('connection_timeout_ms');
    table.dropColumn('socket_keepalive');
  });
};
