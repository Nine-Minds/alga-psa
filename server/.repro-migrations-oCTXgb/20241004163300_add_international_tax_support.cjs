exports.up = function(knex) {
  return knex.schema
    // Extend companies table
    .alterTable('companies', function(table) {
      table.string('tax_id_number');
    })
    // Extend tenants table
    .alterTable('tenants', function(table) {
      table.string('tax_id_number');
    })
    // Update tax_rates table
    .alterTable('tax_rates', function(table) {
      table.enum('tax_type', ['VAT', 'GST', 'Sales Tax']);
      table.string('country_code', 2);
      table.boolean('is_reverse_charge_applicable').defaultTo(false);
      table.boolean('is_composite').defaultTo(false);
      table.boolean('is_active').defaultTo(true);
      table.jsonb('conditions');
    })
    // Create company_tax_settings table
    .createTable('company_tax_settings', function(table) {
      table.uuid('tenant').notNullable();
      table.uuid('company_id').notNullable();
      table.uuid('tax_rate_id').notNullable();
      table.boolean('is_reverse_charge_applicable').defaultTo(false);
      table.primary(['tenant', 'company_id']);
      table.foreign('tenant').references('tenants.tenant');
      table.foreign('company_id').references('companies.company_id');
      table.foreign('tax_rate_id').references('tax_rates.tax_rate_id');
    })
    // Update invoice_items table
    .alterTable('invoice_items', function(table) {
      table.bigInteger('net_amount');
    })
    // Create tax_components table
    .createTable('tax_components', function(table) {
      table.uuid('tax_component_id').primary();
      table.uuid('tax_rate_id').notNullable().references('tax_rates.tax_rate_id');
      table.string('name').notNullable();
      table.bigInteger('rate').notNullable();
      table.integer('sequence').notNullable();
      table.boolean('is_compound').defaultTo(false);
      table.date('start_date');
      table.date('end_date');
      table.jsonb('conditions');
      table.timestamps(true, true);
    })
    // Create composite_tax_mappings table
    .createTable('composite_tax_mappings', function(table) {
      table.uuid('composite_tax_id').references('tax_rates.tax_rate_id');
      table.uuid('tax_component_id').references('tax_components.tax_component_id');
      table.integer('sequence').notNullable();
      table.primary(['composite_tax_id', 'tax_component_id']);
    })
    // Create tax_rate_thresholds table
    .createTable('tax_rate_thresholds', function(table) {
      table.uuid('tax_rate_threshold_id').primary();
      table.uuid('tax_rate_id').references('tax_rates.tax_rate_id');
      table.bigInteger('min_amount');
      table.bigInteger('max_amount');
      table.bigInteger('rate').notNullable();
      table.timestamps(true, true);
    })
    // Create tax_holidays table
    .createTable('tax_holidays', function(table) {
      table.uuid('tax_holiday_id').primary();
      table.uuid('tax_rate_id').notNullable().references('tax_rates.tax_rate_id');
      table.date('start_date').notNullable();
      table.date('end_date').notNullable();
      table.string('description');
      table.timestamps(true, true);
    });
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('tax_holidays')
    .dropTableIfExists('tax_rate_thresholds')
    .dropTableIfExists('composite_tax_mappings')
    .dropTableIfExists('tax_components')
    .alterTable('invoice_items', function(table) {
      table.dropColumn('net_amount');
    })
    .dropTableIfExists('company_tax_settings')
    .alterTable('tax_rates', function(table) {
      table.dropColumn('tax_type');
      table.dropColumn('country_code');
      table.dropColumn('is_reverse_charge_applicable');
      table.dropColumn('is_composite');
      table.dropColumn('is_active');
      table.dropColumn('conditions');
    })
    .alterTable('tenants', function(table) {
      table.dropColumn('tax_id_number');
    })
    .alterTable('companies', function(table) {
      table.dropColumn('tax_id_number');
    });
};