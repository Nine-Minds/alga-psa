/**
 * Migration to rename bucket_usage columns from hours to minutes.
 */

exports.up = async function(knex) {
  await knex.schema.alterTable('bucket_usage', function(table) {
    table.renameColumn('hours_used', 'minutes_used');
    table.renameColumn('overage_hours', 'overage_minutes');
    table.renameColumn('rolled_over_hours', 'rolled_over_minutes');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('bucket_usage', function(table) {
    table.renameColumn('minutes_used', 'hours_used');
    table.renameColumn('overage_minutes', 'overage_hours');
    table.renameColumn('rolled_over_minutes', 'rolled_over_hours');
  });
};