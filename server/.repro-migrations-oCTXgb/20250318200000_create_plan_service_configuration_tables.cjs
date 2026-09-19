/**
 * Migration to create the plan service configuration tables
 * This implements the normalized schema for service-specific configuration within plans
 * Includes robust logic to handle potential pre-existing conflicting constraints.
 */
exports.up = async function(knex) { // Make function async

  // Cleanup logic removed - handled by 20250331164116_alter_plan_service_configuration_pk.cjs


  // Create tables using hasTable check + createTable pattern
  if (!(await knex.schema.hasTable('plan_service_configuration'))) {
    await knex.schema.createTable('plan_service_configuration', function(table) {
      table.uuid('config_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('plan_id').notNullable();
      table.uuid('service_id').notNullable();
      table.string('configuration_type', 50).notNullable();
      table.decimal('custom_rate', 10, 2).nullable();
      table.integer('quantity').nullable();
      table.uuid('tenant').notNullable();
      table.timestamps(true, true);
      table.unique(['plan_id', 'service_id', 'tenant']);
      // Define composite primary key including tenant with explicit name
      table.primary(['tenant', 'config_id'], 'plan_service_configuration_comp_pkey');
      table.index(['plan_id']);
      table.index(['service_id']);
      table.index(['tenant']);
    });
  }

  // Add FKs separately after table creation/potential modification
  // Check if FKs already exist before adding
  const pscFks = await knex.raw(`
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE table_name = 'plan_service_configuration'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name IN ('psc_plan_id_tenant_fk', 'psc_service_id_tenant_fk')
    AND table_schema = current_schema()
  `);
  const existingPscFkNames = pscFks.rows.map(r => r.constraint_name);

  await knex.schema.alterTable('plan_service_configuration', function(table) {
      if (!existingPscFkNames.includes('psc_plan_id_tenant_fk')) {
          table.foreign(['plan_id', 'tenant'], 'psc_plan_id_tenant_fk')
               .references(['plan_id', 'tenant']).inTable('billing_plans').onDelete('CASCADE');
      }
      if (!existingPscFkNames.includes('psc_service_id_tenant_fk')) {
          table.foreign(['service_id', 'tenant'], 'psc_service_id_tenant_fk')
               .references(['service_id', 'tenant']).inTable('service_catalog').onDelete('CASCADE');
      }
  });


  if (!(await knex.schema.hasTable('plan_service_fixed_config'))) {
    await knex.schema.createTable('plan_service_fixed_config', function(table) {
      table.uuid('config_id').notNullable();
      table.uuid('tenant').notNullable();
      table.primary(['tenant', 'config_id']);
      table.foreign(['tenant', 'config_id'], 'psfc_tenant_config_id_fk') // Specific FK name
           .references(['tenant', 'config_id'])
           .inTable('plan_service_configuration') // References the PK columns
           .onDelete('CASCADE');
      table.boolean('enable_proration').notNullable().defaultTo(false);
      table.string('billing_cycle_alignment', 20).notNullable().defaultTo('start');
      table.timestamps(true, true);
      table.index(['tenant']);
    });
  }

  if (!(await knex.schema.hasTable('plan_service_hourly_config'))) {
    await knex.schema.createTable('plan_service_hourly_config', function(table) {
      table.uuid('config_id').notNullable();
      table.uuid('tenant').notNullable();
      table.primary(['tenant', 'config_id']);
      table.foreign(['tenant', 'config_id'], 'pshc_tenant_config_id_fk') // Specific FK name
           .references(['tenant', 'config_id'])
           .inTable('plan_service_configuration') // References the PK columns
           .onDelete('CASCADE');
      table.integer('minimum_billable_time').notNullable().defaultTo(15);
      table.integer('round_up_to_nearest').notNullable().defaultTo(15);
      table.boolean('enable_overtime').notNullable().defaultTo(false);
      table.decimal('overtime_rate', 10, 2).nullable();
      table.integer('overtime_threshold').nullable();
      table.boolean('enable_after_hours_rate').notNullable().defaultTo(false);
      table.decimal('after_hours_multiplier', 5, 2).nullable();
      table.timestamps(true, true);
      table.index(['tenant']);
    });
  }

  if (!(await knex.schema.hasTable('plan_service_usage_config'))) {
    await knex.schema.createTable('plan_service_usage_config', function(table) {
      table.uuid('config_id').notNullable();
      table.uuid('tenant').notNullable();
      table.primary(['tenant', 'config_id']);
      table.foreign(['tenant', 'config_id'], 'psuc_tenant_config_id_fk') // Specific FK name
           .references(['tenant', 'config_id'])
           .inTable('plan_service_configuration') // References the PK columns
           .onDelete('CASCADE');
      table.string('unit_of_measure', 50).notNullable().defaultTo('Unit');
      table.boolean('enable_tiered_pricing').notNullable().defaultTo(false);
      table.integer('minimum_usage').notNullable().defaultTo(0);
      table.timestamps(true, true);
      table.index(['tenant']);
    });
  }

  if (!(await knex.schema.hasTable('plan_service_bucket_config'))) {
    await knex.schema.createTable('plan_service_bucket_config', function(table) {
      table.uuid('config_id').notNullable();
      table.uuid('tenant').notNullable();
      table.primary(['tenant', 'config_id']);
      table.foreign(['tenant', 'config_id'], 'psbc_tenant_config_id_fk') // Specific FK name
           .references(['tenant', 'config_id'])
           .inTable('plan_service_configuration') // References the PK columns
           .onDelete('CASCADE');
      table.integer('total_hours').notNullable();
      table.string('billing_period', 50).notNullable().defaultTo('monthly');
      table.decimal('overage_rate', 10, 2).notNullable().defaultTo(0);
      table.boolean('allow_rollover').notNullable().defaultTo(false);
      table.timestamps(true, true);
      table.index(['tenant']);
    });
  }

  if (!(await knex.schema.hasTable('plan_service_rate_tiers'))) {
    await knex.schema.createTable('plan_service_rate_tiers', function(table) {
      table.uuid('tier_id').defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('config_id').notNullable();
      table.uuid('tenant').notNullable();
      table.primary(['tenant', 'tier_id']);
      table.foreign(['tenant', 'config_id'], 'psrt_tenant_config_id_fk') // Specific FK name
           .references(['tenant', 'config_id'])
           .inTable('plan_service_configuration') // References the PK columns
           .onDelete('CASCADE');
      table.integer('min_quantity').notNullable();
      table.integer('max_quantity').nullable();
      table.decimal('rate', 10, 2).notNullable();
      table.timestamps(true, true);
      table.unique(['config_id', 'min_quantity', 'tenant']);
      table.index(['config_id']);
      table.index(['tenant']);
    });
  }

  // user_type_rates depends on plan_service_hourly_config
  if (!(await knex.schema.hasTable('user_type_rates'))) {
    await knex.schema.createTable('user_type_rates', function(table) {
      table.uuid('rate_id').defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('config_id').notNullable(); // This refers to plan_service_hourly_config PK
      table.uuid('tenant').notNullable();
      table.primary(['tenant', 'rate_id']);
      table.foreign(['tenant', 'config_id'], 'utr_tenant_config_id_fk') // Specific FK name
           .references(['tenant', 'config_id'])
           .inTable('plan_service_hourly_config') // Correct target table
           .onDelete('CASCADE');
      table.string('user_type', 50).notNullable();
      table.decimal('rate', 10, 2).notNullable();
      table.timestamps(true, true);
      table.unique(['config_id', 'user_type', 'tenant']);
      table.index(['config_id']);
      table.index(['tenant']);
    });
  }
}; // End exports.up

exports.down = function(knex) {
  // Drop tables in reverse order of creation, respecting dependencies
  // Need to drop FKs before tables
  return knex.schema
    .alterTable('user_type_rates', function(table) { table.dropForeign(['tenant', 'config_id'], 'utr_tenant_config_id_fk'); })
    .dropTableIfExists('user_type_rates')
    .alterTable('plan_service_rate_tiers', function(table) { table.dropForeign(['tenant', 'config_id'], 'psrt_tenant_config_id_fk'); })
    .dropTableIfExists('plan_service_rate_tiers')
    .alterTable('plan_service_bucket_config', function(table) { table.dropForeign(['tenant', 'config_id'], 'psbc_tenant_config_id_fk'); })
    .dropTableIfExists('plan_service_bucket_config')
    .alterTable('plan_service_usage_config', function(table) { table.dropForeign(['tenant', 'config_id'], 'psuc_tenant_config_id_fk'); })
    .dropTableIfExists('plan_service_usage_config')
    .alterTable('plan_service_hourly_config', function(table) { table.dropForeign(['tenant', 'config_id'], 'pshc_tenant_config_id_fk'); })
    .dropTableIfExists('plan_service_hourly_config')
    .alterTable('plan_service_fixed_config', function(table) { table.dropForeign(['tenant', 'config_id'], 'psfc_tenant_config_id_fk'); })
    .dropTableIfExists('plan_service_fixed_config')
    .alterTable('plan_service_configuration', function(table) {
        // Drop FKs defined on this table first
        table.dropForeign(['plan_id', 'tenant'], 'psc_plan_id_tenant_fk');
        table.dropForeign(['service_id', 'tenant'], 'psc_service_id_tenant_fk');
    })
    .dropTableIfExists('plan_service_configuration'); // Base table
};