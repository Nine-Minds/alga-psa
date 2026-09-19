/**
 * Migration to rename plan_service_bucket_config.total_hours to total_minutes.
 */

exports.up = async function(knex) {
  await knex.schema.alterTable('plan_service_bucket_config', function(table) {
    table.renameColumn('total_hours', 'total_minutes');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('plan_service_bucket_config', function(table) {
    table.renameColumn('total_minutes', 'total_hours');
  });
};