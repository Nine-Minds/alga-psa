/**
 * Create contract_line_presets table
 *
 * This table stores reusable contract line presets/templates that can be
 * copied into contracts or contract templates. These are not actual contract
 * lines associated with clients, but templates for quick setup.
 *
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('contract_line_presets', (table) => {
    table.uuid('tenant').notNullable();
    table
      .uuid('preset_id')
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));
    table.string('preset_name', 255).notNullable();
    table.string('billing_frequency', 50).notNullable().defaultTo('monthly');
    table.string('service_category', 100);
    table.string('contract_line_type', 50).notNullable(); // 'Fixed', 'Hourly', or 'Usage'

    // Hourly-specific fields
    table.decimal('hourly_rate', 10, 2);
    table.integer('minimum_billable_time');
    table.integer('round_up_to_nearest');
    table.boolean('enable_overtime').defaultTo(false);
    table.decimal('overtime_rate', 10, 2);
    table.integer('overtime_threshold');
    table.boolean('enable_after_hours_rate').defaultTo(false);
    table.decimal('after_hours_multiplier', 10, 2);

    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // Primary key includes tenant for CitusDB compatibility
    table.primary(['tenant', 'preset_id']);

    // Indexes
    table.index(['tenant', 'contract_line_type'], 'idx_contract_line_presets_type');
  });

  // Foreign key to tenants table
  await knex.raw(`
    ALTER TABLE contract_line_presets
    ADD CONSTRAINT contract_line_presets_tenant_fk
    FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE
  `);
};

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('contract_line_presets');
};
