const tableExists = async (knex, tableName) => {
  const result = await knex.schema.hasTable(tableName);
  return result;
};

exports.up = async function up(knex) {
  const exists = await tableExists(knex, 'contract_pricing_schedules');

  if (!exists) {
    await knex.schema.createTable('contract_pricing_schedules', (table) => {
      // Primary key
      table.uuid('schedule_id').primary().defaultTo(knex.raw('gen_random_uuid()'));

      // Tenant for multi-tenancy
      table.string('tenant', 255).notNullable();

      // Foreign key to plan_bundles (contract/bundle)
      table.uuid('bundle_id').notNullable();

      // Date range for the pricing schedule
      table.timestamp('effective_date', { useTz: true }).notNullable();
      table.timestamp('end_date', { useTz: true });

      // Duration-based end date (alternative to explicit end_date)
      table.integer('duration_value'); // e.g., 6 for "6 months"
      table.enum('duration_unit', ['days', 'weeks', 'months', 'years']); // Unit for duration

      // Custom rate in cents (nullable means use default rate from plan)
      table.integer('custom_rate');

      // Notes for the pricing change
      table.text('notes');

      // Audit columns
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.uuid('created_by');
      table.uuid('updated_by');

      // Indexes
      table.index(['tenant', 'bundle_id'], 'idx_contract_pricing_schedules_bundle');
      table.index(['tenant', 'effective_date'], 'idx_contract_pricing_schedules_effective_date');
    });

    // Add foreign key constraint to plan_bundles
    await knex.raw(`
      ALTER TABLE contract_pricing_schedules
      ADD CONSTRAINT fk_contract_pricing_schedules_bundle
      FOREIGN KEY (tenant, bundle_id)
      REFERENCES plan_bundles (tenant, bundle_id)
      ON DELETE CASCADE;
    `);

    // Add foreign key constraints to users for audit columns
    await knex.raw(`
      ALTER TABLE contract_pricing_schedules
      ADD CONSTRAINT fk_contract_pricing_schedules_created_by
      FOREIGN KEY (tenant, created_by)
      REFERENCES users (tenant, user_id);
    `);

    await knex.raw(`
      ALTER TABLE contract_pricing_schedules
      ADD CONSTRAINT fk_contract_pricing_schedules_updated_by
      FOREIGN KEY (tenant, updated_by)
      REFERENCES users (tenant, user_id);
    `);

    // Check constraint to ensure end_date is after effective_date
    await knex.raw(`
      ALTER TABLE contract_pricing_schedules
      ADD CONSTRAINT chk_contract_pricing_schedules_date_range
      CHECK (end_date IS NULL OR end_date > effective_date);
    `);

    // Check constraint to ensure custom_rate is positive when provided
    await knex.raw(`
      ALTER TABLE contract_pricing_schedules
      ADD CONSTRAINT chk_contract_pricing_schedules_positive_rate
      CHECK (custom_rate IS NULL OR custom_rate >= 0);
    `);

    console.log('Created contract_pricing_schedules table');
  } else {
    console.log('contract_pricing_schedules table already exists, skipping');
  }
};

exports.down = async function down(knex) {
  const exists = await tableExists(knex, 'contract_pricing_schedules');

  if (exists) {
    await knex.schema.dropTableIfExists('contract_pricing_schedules');
    console.log('Dropped contract_pricing_schedules table');
  }
};

exports.config = { transaction: false };