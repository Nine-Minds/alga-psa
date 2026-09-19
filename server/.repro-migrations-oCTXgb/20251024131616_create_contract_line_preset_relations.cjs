/**
 * Create contract_line_preset_services and contract_line_preset_fixed_config tables
 *
 * These tables store the configuration details for contract line presets,
 * mirroring the structure used for actual contract lines.
 *
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  // Create contract_line_preset_services table if it doesn't exist
  const hasPresetServicesTable = await knex.schema.hasTable('contract_line_preset_services');
  if (!hasPresetServicesTable) {
    await knex.schema.createTable('contract_line_preset_services', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('preset_id').notNullable();
      table.uuid('service_id').notNullable();
      table.integer('quantity'); // For fixed fee services
      table.bigInteger('custom_rate'); // For hourly/usage services (stored in cents)
      table.string('unit_of_measure', 50); // For usage services

      table
        .timestamp('created_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());
      table
        .timestamp('updated_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());

      // Composite primary key
      table.primary(['tenant', 'preset_id', 'service_id']);

      // Indexes
      table.index(['tenant', 'preset_id'], 'idx_preset_services_preset');
      table.index(['tenant', 'service_id'], 'idx_preset_services_service');
    });

    // Add foreign keys for preset_services table
    await knex.raw(`
      ALTER TABLE contract_line_preset_services
      ADD CONSTRAINT contract_line_preset_services_tenant_fk
      FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE
    `);

    await knex.raw(`
      ALTER TABLE contract_line_preset_services
      ADD CONSTRAINT contract_line_preset_services_preset_fk
      FOREIGN KEY (tenant, preset_id) REFERENCES contract_line_presets(tenant, preset_id) ON DELETE CASCADE
    `);
  }

  // Create contract_line_preset_fixed_config table if it doesn't exist
  const hasPresetFixedConfigTable = await knex.schema.hasTable('contract_line_preset_fixed_config');
  if (!hasPresetFixedConfigTable) {
    await knex.schema.createTable('contract_line_preset_fixed_config', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('preset_id').notNullable();
      table.decimal('base_rate', 10, 2); // Monthly price for fixed fee plans
      table.boolean('enable_proration').notNullable().defaultTo(false);
      table.string('billing_cycle_alignment', 50).notNullable().defaultTo('start'); // 'start', 'end', or 'prorated'

      table
        .timestamp('created_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());
      table
        .timestamp('updated_at', { useTz: true })
        .notNullable()
        .defaultTo(knex.fn.now());

      // Primary key
      table.primary(['tenant', 'preset_id']);

      // Index
      table.index(['tenant', 'preset_id'], 'idx_preset_fixed_config_preset');
    });

    // Add foreign keys for preset_fixed_config table
    await knex.raw(`
      ALTER TABLE contract_line_preset_fixed_config
      ADD CONSTRAINT contract_line_preset_fixed_config_tenant_fk
      FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE
    `);

    await knex.raw(`
      ALTER TABLE contract_line_preset_fixed_config
      ADD CONSTRAINT contract_line_preset_fixed_config_preset_fk
      FOREIGN KEY (tenant, preset_id) REFERENCES contract_line_presets(tenant, preset_id) ON DELETE CASCADE
    `);
  }
};

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('contract_line_preset_fixed_config');
  await knex.schema.dropTableIfExists('contract_line_preset_services');
};
