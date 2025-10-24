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
  // Check if columns exist before adding them to contracts table
  const hasContractsIsTemplate = await knex.schema.hasColumn('contracts', 'is_template');
  const hasContractsTemplateMetadata = await knex.schema.hasColumn('contracts', 'template_metadata');

  if (!hasContractsIsTemplate || !hasContractsTemplateMetadata) {
    await knex.schema.alterTable('contracts', (table) => {
      if (!hasContractsIsTemplate) {
        table.boolean('is_template').notNullable().defaultTo(true);
      }
      if (!hasContractsTemplateMetadata) {
        table.jsonb('template_metadata');
      }
    });
  }

  // Check if is_template column exists on contract_lines
  const hasContractLinesIsTemplate = await knex.schema.hasColumn('contract_lines', 'is_template');

  if (!hasContractLinesIsTemplate) {
    await knex.schema.alterTable('contract_lines', (table) => {
      table.boolean('is_template').notNullable().defaultTo(true);
    });
  }

  // Check if template_contract_id column exists on client_contracts
  const hasClientContractsTemplateId = await knex.schema.hasColumn('client_contracts', 'template_contract_id');

  if (!hasClientContractsTemplateId) {
    await knex.schema.alterTable('client_contracts', (table) => {
      table.uuid('template_contract_id');
    });
  }

  // Check if template_contract_line_id column exists on client_contract_lines
  const hasClientContractLinesTemplateId = await knex.schema.hasColumn('client_contract_lines', 'template_contract_line_id');

  if (!hasClientContractLinesTemplateId) {
    await knex.schema.alterTable('client_contract_lines', (table) => {
      table.uuid('template_contract_line_id');
    });
  }

  // Create tables only if they don't exist
  const hasContractLineTemplateTerms = await knex.schema.hasTable('contract_line_template_terms');
  if (!hasContractLineTemplateTerms) {
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
  }

  const hasContractTemplateServices = await knex.schema.hasTable('contract_template_services');
  if (!hasContractTemplateServices) {
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
  }

  const hasContractLineServiceDefaults = await knex.schema.hasTable('contract_line_service_defaults');
  if (!hasContractLineServiceDefaults) {
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
  }

  const hasClientContractLineTerms = await knex.schema.hasTable('client_contract_line_terms');
  if (!hasClientContractLineTerms) {
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
  }

  const hasClientContractServices = await knex.schema.hasTable('client_contract_services');
  if (!hasClientContractServices) {
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
  }

  const hasClientContractServiceConfiguration = await knex.schema.hasTable('client_contract_service_configuration');
  if (!hasClientContractServiceConfiguration) {
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
  }

  const hasClientContractServiceBucketConfig = await knex.schema.hasTable('client_contract_service_bucket_config');
  if (!hasClientContractServiceBucketConfig) {
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
  }

  const hasClientContractServiceFixedConfig = await knex.schema.hasTable('client_contract_service_fixed_config');
  if (!hasClientContractServiceFixedConfig) {
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
  }

  const hasClientContractServiceHourlyConfig = await knex.schema.hasTable('client_contract_service_hourly_config');
  if (!hasClientContractServiceHourlyConfig) {
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
  }

  const hasClientContractServiceHourlyConfigs = await knex.schema.hasTable('client_contract_service_hourly_configs');
  if (!hasClientContractServiceHourlyConfigs) {
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
  }

  const hasClientContractServiceRateTiers = await knex.schema.hasTable('client_contract_service_rate_tiers');
  if (!hasClientContractServiceRateTiers) {
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
  }

  const hasClientContractServiceUsageConfig = await knex.schema.hasTable('client_contract_service_usage_config');
  if (!hasClientContractServiceUsageConfig) {
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
  }

  const hasClientContractLinePricing = await knex.schema.hasTable('client_contract_line_pricing');
  if (!hasClientContractLinePricing) {
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
  }

  const hasClientContractLineDiscounts = await knex.schema.hasTable('client_contract_line_discounts');
  if (!hasClientContractLineDiscounts) {
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
  }

  // Foreign key constraints from client_contracts to contracts are not added here.
  // In Citus distributed environments, both tables are distributed and colocated,
  // but foreign keys between distributed tables cannot be reliably enforced across shards.
  // Per the AI coding standards: "Foreign keys from reference tables to distributed tables are not supported."
  // These relationships are enforced at the application level instead.
  // See migration 20251020180500_update_client_contract_template_foreign_keys.cjs for cleanup of these constraints.
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  // No foreign keys to drop since we don't create them in the up migration
  // (Citus distributed tables cannot have foreign keys between them)

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
