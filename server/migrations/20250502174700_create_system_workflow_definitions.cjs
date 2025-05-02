// server/migrations/20250502174700_create_system_workflow_definitions.cjs

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. Create system_workflow_registrations table (mirrors workflow_registrations without tenant_id)
  await knex.schema.createTable('system_workflow_registrations', (table) => {
    table.uuid('registration_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.text('name').notNullable();
    table.text('description').nullable();
    table.text('category').nullable();
    table.specificType('tags', 'TEXT[]').nullable();
    table.text('version').notNullable();
    table.text('status').notNullable(); // e.g., 'active', 'draft'
    table.uuid('source_template_id').nullable(); // FK potentially to a global workflow_templates table
    // created_by might be null or link to a system user concept if needed
    table.uuid('created_by').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.jsonb('definition').notNullable();
    table.jsonb('parameters').nullable();
    table.jsonb('execution_config').nullable();

    // Indexes (excluding tenant-specific ones)
    table.index(['category'], 'idx_system_workflow_registrations_category');
    table.index(['name'], 'idx_system_workflow_registrations_name');
    table.index(['tags'], 'idx_system_workflow_registrations_tags', 'gin');
    table.index(['source_template_id'], 'idx_system_workflow_registrations_template');
    // Add unique constraint on name? Or name+version? Depends on requirements.
    // table.unique(['name', 'version'], { indexName: 'system_workflow_registrations_name_version_unique' });
  });

  // Add FK for source_template_id if workflow_templates table exists and is global
  // await knex.schema.alterTable('system_workflow_registrations', (table) => {
  //   table.foreign('source_template_id').references('workflow_templates.template_id').onDelete('SET NULL');
  // });

  // 2. Create system_workflow_registration_versions table (mirrors workflow_registration_versions without tenant_id)
  await knex.schema.createTable('system_workflow_registration_versions', (table) => {
    table.uuid('version_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.uuid('registration_id').notNullable();
    // Foreign key to system_workflow_registrations
    table.foreign('registration_id').references('system_workflow_registrations.registration_id').onDelete('CASCADE');
    table.text('version').notNullable();
    table.boolean('is_current').notNullable().defaultTo(false);
    table.jsonb('definition').notNullable();
    table.jsonb('parameters').nullable();
    table.jsonb('execution_config').nullable();
    table.uuid('created_by').nullable(); // System workflows might not have a user creator
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // Add updated_at column (missing in original schema fetch but good practice)
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Indexes (excluding tenant-specific ones)
    table.unique(['registration_id', 'version'], { indexName: 'idx_system_workflow_reg_versions_reg_version' });
    // Partial unique index for 'is_current' will be created using raw SQL below
  });

  // Create the partial unique index using raw SQL
  await knex.raw(`
    CREATE UNIQUE INDEX idx_system_workflow_reg_versions_current
    ON system_workflow_registration_versions (registration_id)
    WHERE is_current = true;
  `);

  // 3. Create system_workflow_event_attachments table (mirrors workflow_event_attachments without tenant_id)
  await knex.schema.createTable('system_workflow_event_attachments', (table) => {
    table.uuid('attachment_id').defaultTo(knex.raw('gen_random_uuid()')).primary();
    table.uuid('workflow_id').notNullable();
    // Foreign key to system_workflow_registrations
    table.foreign('workflow_id').references('system_workflow_registrations.registration_id').onDelete('CASCADE');
    table.uuid('event_id').notNullable(); // FK potentially to a global event_catalog table
    table.boolean('is_active').defaultTo(true);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // Unique constraint (excluding tenant_id)
    table.unique(['workflow_id', 'event_id'], { indexName: 'system_workflow_event_attachments_workflow_id_event_id_unique' });
    table.index(['event_id'], 'idx_system_workflow_event_attachments_event_id');
  });

  // Add FK for event_id if event_catalog table exists and is global
  // await knex.schema.alterTable('system_workflow_event_attachments', (table) => {
  //   table.foreign('event_id').references('event_catalog.event_id').onDelete('CASCADE');
  // });

  // Add trigger for updated_at timestamp (assuming the function exists or creating it if not)
  // Check if function exists before creating
  const triggerFunctionExists = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc
      WHERE proname = 'update_updated_at_column'
    );
  `).then(result => result.rows[0].exists);

  if (!triggerFunctionExists) {
    await knex.raw(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
         NEW.updated_at = now();
         RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);
  }

  await knex.raw(`
    CREATE TRIGGER set_system_workflow_registrations_updated_at
    BEFORE UPDATE ON system_workflow_registrations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  await knex.raw(`
    CREATE TRIGGER set_system_workflow_event_attachments_updated_at
    BEFORE UPDATE ON system_workflow_event_attachments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);

  await knex.raw(`
    CREATE TRIGGER set_system_workflow_registration_versions_updated_at
    BEFORE UPDATE ON system_workflow_registration_versions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop triggers first
  await knex.raw('DROP TRIGGER IF EXISTS set_system_workflow_registration_versions_updated_at ON system_workflow_registration_versions;');
  await knex.raw('DROP TRIGGER IF EXISTS set_system_workflow_event_attachments_updated_at ON system_workflow_event_attachments;');
  await knex.raw('DROP TRIGGER IF EXISTS set_system_workflow_registrations_updated_at ON system_workflow_registrations;');
  // Consider dropping the function only if it was created by this migration and not used elsewhere.
  // For safety, it's often left unless explicitly managed.

  // Drop tables in reverse order of creation
  await knex.schema.dropTableIfExists('system_workflow_event_attachments');
  // Drop the raw index before dropping the table
  await knex.raw('DROP INDEX IF EXISTS idx_system_workflow_reg_versions_current;');
  await knex.schema.dropTableIfExists('system_workflow_registration_versions');
  await knex.schema.dropTableIfExists('system_workflow_registrations');
};