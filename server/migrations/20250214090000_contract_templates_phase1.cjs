/**
 * Contract template separation – phase 1 schema updates
 *
 * - Introduce template metadata flags/columns.
 * - Prepare client-specific pricing/configuration tables.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('contracts', (table) => {
    table.boolean('is_template').notNullable().defaultTo(true);
    table.jsonb('template_metadata');
  });

  await knex.schema.alterTable('contract_lines', (table) => {
    table.boolean('is_template').notNullable().defaultTo(true);
  });

  await knex.schema.alterTable('client_contracts', (table) => {
    table.uuid('template_contract_id');
  });

  await knex.schema.alterTable('client_contract_lines', (table) => {
    table.uuid('template_contract_line_id');
  });

  await knex.schema.createTable('contract_line_template_terms', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('contract_line_id').notNullable();
    table.string('billing_frequency', 50);
    table.boolean('enable_overtime');
    table.decimal('overtime_rate', 10, 2);
    table.integer('overtime_threshold');
    table.boolean('enable_after_hours_rate');
    table.decimal('after_hours_multiplier', 10, 2);
    table.integer('minimum_billable_time');
    table.integer('round_up_to_nearest');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'contract_line_id']);
    table
      .foreign(['tenant', 'contract_line_id'])
      .references(['tenant', 'contract_line_id'])
      .inTable('contract_lines')
      .onDelete('CASCADE');
  });

  await knex.schema.createTable('contract_template_services', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('contract_line_id').notNullable();
    table.uuid('service_id').notNullable();
    table.integer('default_quantity');
    table.text('notes');
    table.integer('display_order').notNullable().defaultTo(0);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'contract_line_id', 'service_id']);
    table
      .foreign(['tenant', 'contract_line_id'])
      .references(['tenant', 'contract_line_id'])
      .inTable('contract_lines')
      .onDelete('CASCADE');
    table
      .foreign(['tenant', 'service_id'])
      .references(['tenant', 'service_id'])
      .inTable('service_catalog')
      .onDelete('CASCADE');
  });

  await knex.schema.createTable('contract_line_service_defaults', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('default_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('contract_line_id').notNullable();
    table.uuid('service_id').notNullable();
    table.string('line_type', 50);
    table.string('default_tax_behavior', 50);
    table.jsonb('metadata');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'default_id']);
    table
      .foreign(['tenant', 'contract_line_id'])
      .references(['tenant', 'contract_line_id'])
      .inTable('contract_lines')
      .onDelete('CASCADE');
    table
      .foreign(['tenant', 'service_id'])
      .references(['tenant', 'service_id'])
      .inTable('service_catalog')
      .onDelete('CASCADE');
    table.unique(['tenant', 'contract_line_id', 'service_id'], 'contract_line_service_defaults_unique');
  });

  await knex.schema.createTable('client_contract_line_terms', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('client_contract_line_id').notNullable();
    table.string('billing_frequency', 50);
    table.boolean('enable_overtime').notNullable().defaultTo(false);
    table.decimal('overtime_rate', 10, 2);
    table.integer('overtime_threshold');
    table.boolean('enable_after_hours_rate').notNullable().defaultTo(false);
    table.decimal('after_hours_multiplier', 10, 2);
    table.integer('minimum_billable_time');
    table.integer('round_up_to_nearest');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'client_contract_line_id']);
    table
      .foreign(['tenant', 'client_contract_line_id'])
      .references(['tenant', 'client_contract_line_id'])
      .inTable('client_contract_lines')
      .onDelete('CASCADE');
  });

  await knex.schema.createTable('client_contract_services', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('client_contract_service_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('client_contract_line_id').notNullable();
    table.uuid('service_id').notNullable();
    table.integer('quantity');
    table.decimal('custom_rate', 10, 2);
    table.timestamp('effective_date');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'client_contract_service_id']);
    table
      .foreign(['tenant', 'client_contract_line_id'])
      .references(['tenant', 'client_contract_line_id'])
      .inTable('client_contract_lines')
      .onDelete('CASCADE');
    table
      .foreign(['tenant', 'service_id'])
      .references(['tenant', 'service_id'])
      .inTable('service_catalog')
      .onDelete('CASCADE');
    table.unique(['tenant', 'client_contract_line_id', 'service_id'], 'client_contract_services_unique');
  });

  await knex.schema.createTable('client_contract_service_configuration', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('config_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('client_contract_service_id').notNullable();
    table.string('configuration_type', 50).notNullable();
    table.decimal('custom_rate', 10, 2);
    table.integer('quantity');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'config_id']);
    table
      .foreign(['tenant', 'client_contract_service_id'])
      .references(['tenant', 'client_contract_service_id'])
      .inTable('client_contract_services')
      .onDelete('CASCADE');
  });

  await knex.schema.createTable('client_contract_service_bucket_config', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('config_id').notNullable();
    table.integer('total_minutes').notNullable();
    table.string('billing_period', 50).notNullable().defaultTo('monthly');
    table.decimal('overage_rate', 10, 2).notNullable().defaultTo(0);
    table.boolean('allow_rollover').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'config_id']);
    table
      .foreign(['tenant', 'config_id'])
      .references(['tenant', 'config_id'])
      .inTable('client_contract_service_configuration')
      .onDelete('CASCADE');
  });

  await knex.schema.createTable('client_contract_service_fixed_config', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('config_id').notNullable();
    table.decimal('base_rate', 10, 2);
    table.boolean('enable_proration').notNullable().defaultTo(false);
    table.string('billing_cycle_alignment', 50);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'config_id']);
    table
      .foreign(['tenant', 'config_id'])
      .references(['tenant', 'config_id'])
      .inTable('client_contract_service_configuration')
      .onDelete('CASCADE');
  });

  await knex.schema.createTable('client_contract_service_hourly_config', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('config_id').notNullable();
    table.integer('minimum_billable_time').notNullable().defaultTo(15);
    table.integer('round_up_to_nearest').notNullable().defaultTo(15);
    table.boolean('enable_overtime').notNullable().defaultTo(false);
    table.decimal('overtime_rate', 10, 2);
    table.integer('overtime_threshold');
    table.boolean('enable_after_hours_rate').notNullable().defaultTo(false);
    table.decimal('after_hours_multiplier', 10, 2);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'config_id']);
    table
      .foreign(['tenant', 'config_id'])
      .references(['tenant', 'config_id'])
      .inTable('client_contract_service_configuration')
      .onDelete('CASCADE');
  });

  await knex.schema.createTable('client_contract_service_hourly_configs', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('config_id').notNullable();
    table.decimal('hourly_rate', 10, 2).notNullable();
    table.integer('minimum_billable_time').notNullable();
    table.integer('round_up_to_nearest').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'config_id']);
    table
      .foreign(['tenant', 'config_id'])
      .references(['tenant', 'config_id'])
      .inTable('client_contract_service_configuration')
      .onDelete('CASCADE');
  });

  await knex.schema.createTable('client_contract_service_rate_tiers', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('tier_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('config_id').notNullable();
    table.integer('min_quantity').notNullable();
    table.integer('max_quantity');
    table.decimal('rate', 10, 2).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'tier_id']);
    table
      .foreign(['tenant', 'config_id'])
      .references(['tenant', 'config_id'])
      .inTable('client_contract_service_configuration')
      .onDelete('CASCADE');
  });

  await knex.schema.createTable('client_contract_service_usage_config', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('config_id').notNullable();
    table.string('unit_of_measure', 50).notNullable().defaultTo('Unit');
    table.boolean('enable_tiered_pricing').notNullable().defaultTo(false);
    table.integer('minimum_usage').notNullable().defaultTo(0);
    table.decimal('base_rate', 10, 2);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'config_id']);
    table
      .foreign(['tenant', 'config_id'])
      .references(['tenant', 'config_id'])
      .inTable('client_contract_service_configuration')
      .onDelete('CASCADE');
  });

  await knex.schema.createTable('client_contract_line_pricing', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('client_contract_line_id').notNullable();
    table.uuid('template_contract_line_id');
    table.uuid('template_contract_id');
    table.decimal('custom_rate', 10, 2);
    table.text('notes');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'client_contract_line_id']);
    table
      .foreign(['tenant', 'client_contract_line_id'])
      .references(['tenant', 'client_contract_line_id'])
      .inTable('client_contract_lines')
      .onDelete('CASCADE');
    table
      .foreign(['tenant', 'template_contract_line_id'])
      .references(['tenant', 'contract_line_id'])
      .inTable('contract_lines');
    table
      .foreign(['tenant', 'template_contract_id'])
      .references(['tenant', 'contract_id'])
      .inTable('contracts');
  });

  await knex.schema.createTable('client_contract_line_discounts', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('client_contract_line_id').notNullable();
    table.uuid('discount_id').notNullable();
    table.decimal('applied_rate', 10, 2);
    table.timestamp('start_date');
    table.timestamp('end_date');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'client_contract_line_id', 'discount_id']);
    table
      .foreign(['tenant', 'client_contract_line_id'])
      .references(['tenant', 'client_contract_line_id'])
      .inTable('client_contract_lines')
      .onDelete('CASCADE');
    table
      .foreign(['tenant', 'discount_id'])
      .references(['tenant', 'discount_id'])
      .inTable('contract_line_discounts')
      .onDelete('SET NULL');
  });

  await knex.schema.alterTable('client_contracts', (table) => {
    table
      .foreign(['tenant', 'template_contract_id'])
      .references(['tenant', 'contract_id'])
      .inTable('contracts');
  });

  await knex.schema.alterTable('client_contract_lines', (table) => {
    table
      .foreign(['tenant', 'template_contract_line_id'])
      .references(['tenant', 'contract_line_id'])
      .inTable('contract_lines');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.table('client_contract_lines', (table) => {
    table.dropForeign(['tenant', 'template_contract_line_id']);
  });

  await knex.schema.table('client_contracts', (table) => {
    table.dropForeign(['tenant', 'template_contract_id']);
  });

  await knex.schema.dropTableIfExists('client_contract_line_discounts');
  await knex.schema.dropTableIfExists('client_contract_line_pricing');
  await knex.schema.dropTableIfExists('client_contract_service_usage_config');
  await knex.schema.dropTableIfExists('client_contract_service_rate_tiers');
  await knex.schema.dropTableIfExists('client_contract_service_hourly_configs');
  await knex.schema.dropTableIfExists('client_contract_service_hourly_config');
  await knex.schema.dropTableIfExists('client_contract_service_fixed_config');
  await knex.schema.dropTableIfExists('client_contract_service_bucket_config');
  await knex.schema.dropTableIfExists('client_contract_service_configuration');
  await knex.schema.dropTableIfExists('client_contract_services');
  await knex.schema.dropTableIfExists('client_contract_line_terms');
  await knex.schema.dropTableIfExists('contract_line_service_defaults');
  await knex.schema.dropTableIfExists('contract_template_services');
  await knex.schema.dropTableIfExists('contract_line_template_terms');

  await knex.schema.alterTable('client_contract_lines', (table) => {
    table.dropColumn('template_contract_line_id');
  });

  await knex.schema.alterTable('client_contracts', (table) => {
    table.dropColumn('template_contract_id');
  });

  await knex.schema.alterTable('contract_lines', (table) => {
    table.dropColumn('is_template');
  });

  await knex.schema.alterTable('contracts', (table) => {
    table.dropColumn('is_template');
    table.dropColumn('template_metadata');
  });
};
