
exports.up = function(knex) {
  return knex.schema.table('google_email_provider_config', function (table) {
    table.timestamp('pubsub_initialised_at').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.table('google_email_provider_config', function (table) {
    table.dropColumn('pubsub_initialised_at');
  });
};
