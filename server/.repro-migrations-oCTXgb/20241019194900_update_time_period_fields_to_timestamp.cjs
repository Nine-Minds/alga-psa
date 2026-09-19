exports.up = async function (knex) {
  await knex.schema
    .alterTable('time_periods', function (table) {
      table.timestamp('start_date').alter();
      table.timestamp('end_date').alter();
    })
    .alterTable('time_period_settings', function (table) {
      table.timestamp('effective_from').alter();
      table.timestamp('effective_to').alter();
      table.timestamp('created_at').alter();
      table.timestamp('updated_at').alter();
    })
    .alterTable('time_entries', function (table) {
      table.timestamp('start_time').alter();
      table.timestamp('end_time').alter();
      table.timestamp('created_at').alter();
      table.timestamp('updated_at').alter();
    })
    .alterTable('time_sheets', function (table) {
      table.timestamp('submitted_at').alter();
      table.timestamp('approved_at').alter();
    })
    .alterTable('time_sheet_comments', function (table) {
      table.timestamp('created_at').alter();
    });
};

exports.down = function (knex) {
  return knex.schema
    .alterTable('time_periods', function (table) {
      table.date('start_date').alter();
      table.date('end_date').alter();
    })
    .alterTable('time_period_settings', function (table) {
      table.date('effective_from').alter();
      table.date('effective_to').alter();
      table.date('created_at').alter();
      table.date('updated_at').alter();
    })
    .alterTable('time_entries', function (table) {
      table.datetime('start_time').alter();
      table.datetime('end_time').alter();
      table.datetime('created_at').alter();
      table.datetime('updated_at').alter();
    })
    .alterTable('time_sheets', function (table) {
      table.datetime('submitted_at').alter();
      table.datetime('approved_at').alter();
    })
    .alterTable('time_sheet_comments', function (table) {
      table.datetime('created_at').alter();
    });
};
