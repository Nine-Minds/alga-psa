
exports.up = function(knex) {
  return knex.schema.alterTable('google_email_provider_config', (table) => {
    table.timestamp('pubsub_initialised_at').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('google_email_provider_config', (table) => {
    table.dropColumn('pubsub_initialised_at');
  });
};
