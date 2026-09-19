/**
 * Make Google email provider OAuth app fields nullable.
 *
 * We store OAuth client credentials in tenant secrets. The DB row should not require them.
 */

exports.up = function (knex) {
  return knex.schema.alterTable('google_email_provider_config', function (table) {
    table.string('client_id', 255).nullable().alter();
    table.text('client_secret').nullable().alter();
    table.string('project_id', 255).nullable().alter();
    table.text('redirect_uri').nullable().alter();
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('google_email_provider_config', function (table) {
    table.string('client_id', 255).notNullable().alter();
    table.text('client_secret').notNullable().alter();
    table.string('project_id', 255).notNullable().alter();
    table.text('redirect_uri').notNullable().alter();
  });
};

// Citus deployments cannot alter distributed tables inside a transaction.
exports.config = { transaction: false };
