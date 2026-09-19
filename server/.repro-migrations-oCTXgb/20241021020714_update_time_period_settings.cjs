// File: server/migrations/20241021020714_update_time_period_settings.js

exports.up = async function(knex) {
    await knex.schema.alterTable('time_period_settings', (table) => {
      // New fields
      table.integer('start_month').unsigned().nullable();
      table.integer('start_day_of_month').unsigned().nullable();
      table.integer('end_month').unsigned().nullable();
      table.integer('end_day_of_month').unsigned().nullable();
    });
  
    // Add check constraint using raw SQL
    await knex.raw(`
      ALTER TABLE time_period_settings
      ADD CONSTRAINT check_frequency_unit_fields
      CHECK (
        (frequency_unit = 'day') OR
        (frequency_unit = 'week' AND start_day IS NOT NULL AND end_day IS NOT NULL) OR
        (frequency_unit = 'month' AND start_day IS NOT NULL AND end_day IS NOT NULL) OR
        (frequency_unit = 'year' AND start_month IS NOT NULL AND start_day_of_month IS NOT NULL AND end_month IS NOT NULL AND end_day_of_month IS NOT NULL)
      )
    `);
  };
  
  exports.down = async function(knex) {
    // Remove the check constraint
    await knex.raw(`
      ALTER TABLE time_period_settings
      DROP CONSTRAINT IF EXISTS check_frequency_unit_fields
    `);
  
    await knex.schema.alterTable('time_period_settings', (table) => {
      // Remove the new columns
      table.dropColumn('start_month');
      table.dropColumn('start_day_of_month');
      table.dropColumn('end_month');
      table.dropColumn('end_day_of_month');
    });
  };