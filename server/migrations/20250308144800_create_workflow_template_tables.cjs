/**
 * Migration to create workflow template and registration tables
 * This implements the database-driven workflow registration system
 */
exports.up = async function(knex) {
  // Create workflow_template_categories table
  await knex.schema.createTable('workflow_template_categories', (table) => {
    table.uuid('category_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.text('tenant_id').notNullable();
    table.text('name').notNullable();
    table.text('description');
    table.uuid('parent_category_id').references('category_id').inTable('workflow_template_categories').onDelete('CASCADE');
    table.integer('display_order').notNullable().defaultTo(0);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    
    // Row-level security for CitusDB compatibility
    // Note: Check constraints will be added after table creation
  });

  // Create unique index on tenant and name
  await knex.raw(`
    CREATE UNIQUE INDEX idx_workflow_template_categories_tenant_name
    ON workflow_template_categories(tenant_id, name);
  `);

  // Create workflow_templates table
  await knex.schema.createTable('workflow_templates', (table) => {
    table.uuid('template_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.text('tenant_id').notNullable();
    table.text('name').notNullable();
    table.text('description');
    table.text('category');
    table.specificType('tags', 'TEXT[]');
    table.text('version').notNullable();
    table.text('status').notNullable(); // draft, published, deprecated
    table.uuid('created_by');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    
    // Template definition (serialized workflow definition)
    table.jsonb('definition').notNullable();
    
    // Parameter schema (JSON Schema format)
    table.jsonb('parameter_schema');
    
    // Default parameter values
    table.jsonb('default_parameters');
    
    // UI metadata (icons, colors, etc.)
    table.jsonb('ui_metadata');
    
    // Row-level security for CitusDB compatibility
    // Note: Check constraints will be added after table creation
  });

  // Create indexes for workflow_templates
  await knex.raw(`
    CREATE INDEX idx_workflow_templates_tenant_category ON workflow_templates(tenant_id, category);
    CREATE INDEX idx_workflow_templates_tenant_name ON workflow_templates(tenant_id, name);
    CREATE INDEX idx_workflow_templates_tags ON workflow_templates USING GIN(tags);
  `);

  // Create workflow_registrations table
  await knex.schema.createTable('workflow_registrations', (table) => {
    table.uuid('registration_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.text('tenant_id').notNullable();
    table.text('name').notNullable();
    table.text('description');
    table.text('category');
    table.specificType('tags', 'TEXT[]');
    table.text('version').notNullable();
    table.text('status').notNullable(); // draft, active, disabled
    table.uuid('source_template_id').references('template_id').inTable('workflow_templates').onDelete('SET NULL');
    table.uuid('created_by');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    
    // Workflow definition (serialized workflow definition)
    table.jsonb('definition').notNullable();
    
    // Parameter values used (if created from template)
    table.jsonb('parameters');
    
    // Execution configuration
    table.jsonb('execution_config');
    
    // Row-level security for CitusDB compatibility
    // Note: Check constraints will be added after table creation
  });

  // Create indexes for workflow_registrations
  await knex.raw(`
    CREATE INDEX idx_workflow_registrations_tenant_category ON workflow_registrations(tenant_id, category);
    CREATE INDEX idx_workflow_registrations_tenant_name ON workflow_registrations(tenant_id, name);
    CREATE INDEX idx_workflow_registrations_tags ON workflow_registrations USING GIN(tags);
    CREATE INDEX idx_workflow_registrations_template ON workflow_registrations(source_template_id);
  `);

  // Create workflow_registration_versions table
  await knex.schema.createTable('workflow_registration_versions', (table) => {
    table.uuid('version_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.uuid('registration_id').notNullable().references('registration_id').inTable('workflow_registrations').onDelete('CASCADE');
    table.text('tenant_id').notNullable();
    table.text('version').notNullable();
    table.boolean('is_current').notNullable().defaultTo(false);
    table.jsonb('definition').notNullable();
    table.jsonb('parameters');
    table.jsonb('execution_config');
    table.uuid('created_by');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    
    // Row-level security for CitusDB compatibility
    // Note: Check constraints will be added after table creation
  });

  // Create indexes for workflow_registration_versions
  await knex.raw(`
    CREATE UNIQUE INDEX idx_workflow_registration_versions_reg_version
      ON workflow_registration_versions(registration_id, version);
    
    CREATE UNIQUE INDEX idx_workflow_registration_versions_current
      ON workflow_registration_versions(registration_id)
      WHERE is_current = TRUE;
  `);
  
  // Enable row level security and create policies
  await knex.raw(`
    ALTER TABLE workflow_template_categories ENABLE ROW LEVEL SECURITY;
    ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;
    ALTER TABLE workflow_registrations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE workflow_registration_versions ENABLE ROW LEVEL SECURITY;
    
    CREATE POLICY tenant_isolation_policy ON workflow_template_categories
      USING (tenant_id::TEXT = current_setting('app.current_tenant')::TEXT);
    
    CREATE POLICY tenant_isolation_policy ON workflow_templates
      USING (tenant_id::TEXT = current_setting('app.current_tenant')::TEXT);
    
    CREATE POLICY tenant_isolation_policy ON workflow_registrations
      USING (tenant_id::TEXT = current_setting('app.current_tenant')::TEXT);
    
    CREATE POLICY tenant_isolation_policy ON workflow_registration_versions
      USING (tenant_id::TEXT = current_setting('app.current_tenant')::TEXT);
  `);
};

exports.down = async function(knex) {
  // Drop tables in reverse order to avoid foreign key constraints
  await knex.schema.dropTableIfExists('workflow_registration_versions');
  await knex.schema.dropTableIfExists('workflow_registrations');
  await knex.schema.dropTableIfExists('workflow_templates');
  await knex.schema.dropTableIfExists('workflow_template_categories');
};