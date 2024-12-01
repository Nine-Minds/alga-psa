exports.up = function(knex) {
  return knex.schema
    // First ensure the referenced columns have unique constraints
    .alterTable('time_entries', function(table) {
      // Add unique constraint to entry_id
      table.unique(['entry_id']);
    })
    .alterTable('usage_tracking', function(table) {
      // Add unique constraint to usage_id
      table.unique(['usage_id']);
    })
    // Then create the linking tables
    .createTable('invoice_time_entries', function(table) {
      table.uuid('invoice_time_entry_id').primary();
      table.uuid('invoice_id').notNullable();
      table.uuid('entry_id').notNullable();
      table.string('tenant').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.foreign('invoice_id')
        .references('invoice_id')
        .inTable('invoices');
      table.foreign('entry_id')
        .references('entry_id')
        .inTable('time_entries');
      // Add index on tenant for performance
      table.index(['tenant']);
    })
    .createTable('invoice_usage_records', function(table) {
      table.uuid('invoice_usage_record_id').primary();
      table.uuid('invoice_id').notNullable();
      table.uuid('usage_id').notNullable();
      table.string('tenant').notNullable();
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.foreign('invoice_id')
        .references('invoice_id')
        .inTable('invoices');
      table.foreign('usage_id')
        .references('usage_id')
        .inTable('usage_tracking');
      // Add index on tenant for performance
      table.index(['tenant']);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('invoice_time_entries')
    .dropTableIfExists('invoice_usage_records')
    .alterTable('time_entries', function(table) {
      table.dropUnique(['entry_id']);
    })
    .alterTable('usage_tracking', function(table) {
      table.dropUnique(['usage_id']);
    });
};
