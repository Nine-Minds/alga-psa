/**
 * Contract template separation — schema introduction (Phase 2)
 *
 * Creates dedicated tables for contract templates and establishes helper views
 * to compare legacy template rows (still stored in `contracts`/`contract_lines`)
 * with the new structure. Foreign keys are created as NOT VALID so we can backfill
 * data before enforcing referential integrity during the cutover window.
 *
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('contract_templates', (table) => {
    table.uuid('tenant').notNullable();
    table
      .uuid('template_id')
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));
    table.string('template_name', 255).notNullable();
    table.text('template_description');
    table
      .string('default_billing_frequency', 50)
      .notNullable()
      .defaultTo('monthly');
    table.string('template_status', 50).notNullable().defaultTo('draft');
    table.jsonb('template_metadata');
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.primary(['tenant', 'template_id']);
    table.unique(['template_id'], 'contract_templates_template_id_unique');
    table.index(['tenant'], 'idx_contract_templates_tenant');
    table.index(['tenant', 'template_status'], 'idx_contract_templates_status');
  });

  await knex.raw(`
    ALTER TABLE contract_templates
    ADD CONSTRAINT contract_templates_tenant_fk
    FOREIGN KEY (tenant) REFERENCES tenants(tenant) NOT VALID
  `);

  await knex.schema.createTable('contract_template_lines', (table) => {
    table.uuid('tenant').notNullable();
    table
      .uuid('template_line_id')
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('template_id').notNullable();
    table.string('template_line_name', 255).notNullable();
    table.text('description');
    table
      .string('billing_frequency', 50)
      .notNullable()
      .defaultTo('monthly');
    table.string('line_type', 50);
    table.uuid('service_category');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.boolean('enable_overtime').notNullable().defaultTo(false);
    table.decimal('overtime_rate', 10, 2);
    table.integer('overtime_threshold');
    table.boolean('enable_after_hours_rate').notNullable().defaultTo(false);
    table.decimal('after_hours_multiplier', 10, 2);
    table.integer('minimum_billable_time');
    table.integer('round_up_to_nearest');
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.primary(['tenant', 'template_line_id']);
    table.index(['tenant', 'template_id'], 'idx_contract_template_lines_template');
    table.index(['tenant', 'line_type'], 'idx_contract_template_lines_type');
  });

  await knex.raw(`
    ALTER TABLE contract_template_lines
    ADD CONSTRAINT contract_template_lines_template_fk
    FOREIGN KEY (tenant, template_id)
    REFERENCES contract_templates(tenant, template_id) NOT VALID
  `);

  await knex.schema.createTable('contract_template_line_mappings', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('template_id').notNullable();
    table.uuid('template_line_id').notNullable();
    table.integer('display_order').notNullable().defaultTo(0);
    table.decimal('custom_rate', 10, 2);
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.primary(['tenant', 'template_id', 'template_line_id']);
    table.index(
      ['tenant', 'template_id', 'display_order'],
      'idx_contract_template_line_mappings_order'
    );
  });

  await knex.raw(`
    ALTER TABLE contract_template_line_mappings
    ADD CONSTRAINT contract_template_line_mappings_template_fk
    FOREIGN KEY (tenant, template_id)
    REFERENCES contract_templates(tenant, template_id) NOT VALID
  `);

  await knex.raw(`
    ALTER TABLE contract_template_line_mappings
    ADD CONSTRAINT contract_template_line_mappings_line_fk
    FOREIGN KEY (tenant, template_line_id)
    REFERENCES contract_template_lines(tenant, template_line_id) NOT VALID
  `);

  await knex.schema.createTable('contract_template_line_services', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('template_line_id').notNullable();
    table.uuid('service_id').notNullable();
    table.integer('quantity');
    table.decimal('custom_rate', 10, 2);
    table.text('notes');
    table.integer('display_order').notNullable().defaultTo(0);
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.primary(['tenant', 'template_line_id', 'service_id']);
    table.index(
      ['tenant', 'template_line_id', 'display_order'],
      'idx_contract_template_line_services_order'
    );
  });

  await knex.raw(`
    ALTER TABLE contract_template_line_services
    ADD CONSTRAINT contract_template_line_services_line_fk
    FOREIGN KEY (tenant, template_line_id)
    REFERENCES contract_template_lines(tenant, template_line_id) NOT VALID
  `);

  await knex.raw(`
    ALTER TABLE contract_template_line_services
    ADD CONSTRAINT contract_template_line_services_service_fk
    FOREIGN KEY (tenant, service_id)
    REFERENCES service_catalog(tenant, service_id) NOT VALID
  `);

  await knex.schema.createTable('contract_template_line_service_configuration', (table) => {
    table.uuid('tenant').notNullable();
    table
      .uuid('config_id')
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('template_line_id').notNullable();
    table.uuid('service_id').notNullable();
    table
      .string('configuration_type', 50)
      .notNullable();
    table.decimal('custom_rate', 10, 2);
    table.integer('quantity');
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.primary(['tenant', 'config_id']);
    table.index(['tenant', 'template_line_id'], 'idx_contract_tpl_service_config_line');
  });

  await knex.raw(`
    ALTER TABLE contract_template_line_service_configuration
    ADD CONSTRAINT contract_tpl_service_config_line_fk
    FOREIGN KEY (tenant, template_line_id, service_id)
    REFERENCES contract_template_line_services(tenant, template_line_id, service_id) NOT VALID
  `);

  await knex.schema.createTable('contract_template_line_service_bucket_config', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('config_id').notNullable();
    table.integer('total_minutes').notNullable();
    table
      .string('billing_period', 50)
      .notNullable()
      .defaultTo('monthly');
    table.decimal('overage_rate', 10, 2).notNullable().defaultTo(0);
    table.boolean('allow_rollover').notNullable().defaultTo(false);
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.primary(['tenant', 'config_id']);
  });

  await knex.raw(`
    ALTER TABLE contract_template_line_service_bucket_config
    ADD CONSTRAINT contract_tpl_bucket_config_fk
    FOREIGN KEY (tenant, config_id)
    REFERENCES contract_template_line_service_configuration(tenant, config_id) NOT VALID
  `);

  await knex.schema.createTable('contract_template_line_service_hourly_config', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('config_id').notNullable();
    table.integer('minimum_billable_time').notNullable().defaultTo(15);
    table.integer('round_up_to_nearest').notNullable().defaultTo(15);
    table.boolean('enable_overtime').notNullable().defaultTo(false);
    table.decimal('overtime_rate', 10, 2);
    table.integer('overtime_threshold');
    table.boolean('enable_after_hours_rate').notNullable().defaultTo(false);
    table.decimal('after_hours_multiplier', 10, 2);
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.primary(['tenant', 'config_id']);
  });

  await knex.raw(`
    ALTER TABLE contract_template_line_service_hourly_config
    ADD CONSTRAINT contract_tpl_hourly_config_fk
    FOREIGN KEY (tenant, config_id)
    REFERENCES contract_template_line_service_configuration(tenant, config_id) NOT VALID
  `);

  await knex.schema.createTable('contract_template_line_service_usage_config', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('config_id').notNullable();
    table.string('unit_of_measure', 255);
    table.boolean('enable_tiered_pricing').notNullable().defaultTo(false);
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.primary(['tenant', 'config_id']);
  });

  await knex.raw(`
    ALTER TABLE contract_template_line_service_usage_config
    ADD CONSTRAINT contract_tpl_usage_config_fk
    FOREIGN KEY (tenant, config_id)
    REFERENCES contract_template_line_service_configuration(tenant, config_id) NOT VALID
  `);

  await knex.schema.createTable('contract_template_line_defaults', (table) => {
    table.uuid('tenant').notNullable();
    table
      .uuid('default_id')
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('template_line_id').notNullable();
    table.uuid('service_id').notNullable();
    table.string('line_type', 50);
    table.string('default_tax_behavior', 50);
    table.jsonb('metadata');
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.primary(['tenant', 'default_id']);
    table.unique(
      ['tenant', 'template_line_id', 'service_id'],
      'contract_template_line_defaults_unique'
    );
  });

  await knex.raw(`
    ALTER TABLE contract_template_line_defaults
    ADD CONSTRAINT contract_tpl_line_defaults_line_fk
    FOREIGN KEY (tenant, template_line_id)
    REFERENCES contract_template_lines(tenant, template_line_id) NOT VALID
  `);

  await knex.raw(`
    ALTER TABLE contract_template_line_defaults
    ADD CONSTRAINT contract_tpl_line_defaults_service_fk
    FOREIGN KEY (tenant, service_id)
    REFERENCES service_catalog(tenant, service_id) NOT VALID
  `);

  await knex.schema.createTable('contract_template_line_terms', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('template_line_id').notNullable();
    table.string('billing_frequency', 50);
    table.boolean('enable_overtime');
    table.decimal('overtime_rate', 10, 2);
    table.integer('overtime_threshold');
    table.boolean('enable_after_hours_rate');
    table.decimal('after_hours_multiplier', 10, 2);
    table.integer('minimum_billable_time');
    table.integer('round_up_to_nearest');
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.primary(['tenant', 'template_line_id']);
  });

  await knex.raw(`
    ALTER TABLE contract_template_line_terms
    ADD CONSTRAINT contract_tpl_line_terms_line_fk
    FOREIGN KEY (tenant, template_line_id)
    REFERENCES contract_template_lines(tenant, template_line_id) NOT VALID
  `);

  await knex.schema.createTable('contract_template_line_fixed_config', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('template_line_id').notNullable();
    table.decimal('base_rate', 10, 2);
    table.boolean('enable_proration').notNullable().defaultTo(false);
    table.string('billing_cycle_alignment', 255).notNullable().defaultTo('start');
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.primary(['tenant', 'template_line_id']);
  });

  await knex.raw(`
    ALTER TABLE contract_template_line_fixed_config
    ADD CONSTRAINT contract_tpl_fixed_config_line_fk
    FOREIGN KEY (tenant, template_line_id)
    REFERENCES contract_template_lines(tenant, template_line_id) NOT VALID
  `);

  await knex.schema.createTable('contract_template_pricing_schedules', (table) => {
    table.uuid('tenant').notNullable();
    table
      .uuid('schedule_id')
      .notNullable()
      .defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('template_id').notNullable();
    table.date('effective_date').notNullable();
    table.date('end_date');
    table.integer('duration_value');
    table.string('duration_unit', 50);
    table.integer('custom_rate');
    table.text('notes');
    table.uuid('created_by');
    table.uuid('updated_by');
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    table.primary(['tenant', 'schedule_id']);
    table.index(['tenant', 'template_id'], 'idx_contract_tpl_pricing_template');
    table.index(['tenant', 'effective_date'], 'idx_contract_tpl_pricing_effective');
  });

  await knex.raw(`
    ALTER TABLE contract_template_pricing_schedules
    ADD CONSTRAINT contract_tpl_pricing_template_fk
    FOREIGN KEY (tenant, template_id)
    REFERENCES contract_templates(tenant, template_id) NOT VALID
  `);

  await knex.raw(`
    ALTER TABLE contract_template_pricing_schedules
    ADD CONSTRAINT contract_tpl_pricing_created_by_fk
    FOREIGN KEY (tenant, created_by)
    REFERENCES users(tenant, user_id) NOT VALID
  `);

  await knex.raw(`
    ALTER TABLE contract_template_pricing_schedules
    ADD CONSTRAINT contract_tpl_pricing_updated_by_fk
    FOREIGN KEY (tenant, updated_by)
    REFERENCES users(tenant, user_id) NOT VALID
  `);

  // Comparison helpers for legacy vs new template storage
  const hasLegacyTemplateFlag = await knex.schema.hasColumn('contracts', 'is_template');
  const legacyContractsSelect = hasLegacyTemplateFlag
    ? `
    SELECT
      'legacy'::text AS source,
      c.tenant,
      c.contract_id AS template_identifier,
      c.contract_name AS template_name,
      c.contract_description AS template_description,
      c.billing_frequency AS cadence,
      CASE WHEN c.is_active = true THEN 'active' ELSE 'inactive' END AS status,
      NULL::jsonb AS template_metadata,
      c.created_at,
      c.updated_at
    FROM contracts c
    WHERE c.is_template = true`
    : `
    SELECT
      'legacy'::text AS source,
      c.tenant,
      c.contract_id AS template_identifier,
      c.contract_name AS template_name,
      c.contract_description AS template_description,
      c.billing_frequency AS cadence,
      CASE WHEN c.is_active = true THEN 'active' ELSE 'inactive' END AS status,
      NULL::jsonb AS template_metadata,
      c.created_at,
      c.updated_at
    FROM contracts c
    WHERE 1 = 0`;

  await knex.raw(`
    CREATE VIEW contract_template_compare_view AS
    ${legacyContractsSelect}
    UNION ALL
    SELECT
      'new'::text AS source,
      t.tenant,
      t.template_id AS template_identifier,
      t.template_name,
      t.template_description,
      t.default_billing_frequency AS cadence,
      t.template_status AS status,
      t.template_metadata,
      t.created_at,
      t.updated_at
    FROM contract_templates t
  `);

  const hasLegacyTemplateLineFlag = await knex.schema.hasColumn('contract_lines', 'is_template');
  const hasLegacyTemplateTerms = await knex.schema.hasTable('contract_line_template_terms');

  const legacyTemplateLinesSelect = hasLegacyTemplateLineFlag
    ? `
    SELECT
      'legacy'::text AS source,
      cl.tenant,
      cl.contract_line_id AS template_line_identifier,
      cl.contract_line_name AS template_line_name,
      cl.contract_line_type AS line_type,
      cl.billing_frequency,
      cl.is_active,
      cl.enable_overtime,
      cl.overtime_rate,
      cl.overtime_threshold,
      cl.enable_after_hours_rate,
      cl.after_hours_multiplier,
      ${hasLegacyTemplateTerms ? 'terms.minimum_billable_time' : 'NULL::integer'} AS minimum_billable_time,
      ${hasLegacyTemplateTerms ? 'terms.round_up_to_nearest' : 'NULL::integer'} AS round_up_to_nearest,
      cl.created_at,
      cl.updated_at
    FROM contract_lines cl
    ${hasLegacyTemplateTerms ? `LEFT JOIN contract_line_template_terms terms
      ON terms.tenant = cl.tenant
     AND terms.contract_line_id = cl.contract_line_id` : ''}
    WHERE cl.is_template = true`
    : `
    SELECT
      'legacy'::text AS source,
      cl.tenant,
      cl.contract_line_id AS template_line_identifier,
      cl.contract_line_name AS template_line_name,
      cl.contract_line_type AS line_type,
      cl.billing_frequency,
      cl.is_active,
      cl.enable_overtime,
      cl.overtime_rate,
      cl.overtime_threshold,
      cl.enable_after_hours_rate,
      cl.after_hours_multiplier,
      NULL::integer AS minimum_billable_time,
      NULL::integer AS round_up_to_nearest,
      cl.created_at,
      cl.updated_at
    FROM contract_lines cl
    WHERE 1 = 0`;

  await knex.raw(`
    CREATE VIEW contract_template_lines_compare_view AS
    ${legacyTemplateLinesSelect}
    UNION ALL
    SELECT
      'new'::text AS source,
      tl.tenant,
      tl.template_line_id AS template_line_identifier,
      tl.template_line_name,
      tl.line_type,
      tl.billing_frequency,
      tl.is_active,
      tl.enable_overtime,
      tl.overtime_rate,
      tl.overtime_threshold,
      tl.enable_after_hours_rate,
      tl.after_hours_multiplier,
      tl.minimum_billable_time,
      tl.round_up_to_nearest,
      tl.created_at,
      tl.updated_at
    FROM contract_template_lines tl
  `);
};

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw('DROP VIEW IF EXISTS contract_template_lines_compare_view');
  await knex.raw('DROP VIEW IF EXISTS contract_template_compare_view');

  await knex.schema.dropTableIfExists('contract_template_pricing_schedules');
  await knex.schema.dropTableIfExists('contract_template_line_fixed_config');
  await knex.schema.dropTableIfExists('contract_template_line_terms');
  await knex.schema.dropTableIfExists('contract_template_line_defaults');
  await knex.schema.dropTableIfExists('contract_template_line_service_usage_config');
  await knex.schema.dropTableIfExists('contract_template_line_service_hourly_config');
  await knex.schema.dropTableIfExists('contract_template_line_service_bucket_config');
  await knex.schema.dropTableIfExists('contract_template_line_service_configuration');
  await knex.schema.dropTableIfExists('contract_template_line_services');
  await knex.schema.dropTableIfExists('contract_template_line_mappings');
  await knex.schema.dropTableIfExists('contract_template_lines');
  await knex.schema.dropTableIfExists('contract_templates');
};
