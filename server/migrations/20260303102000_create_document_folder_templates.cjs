/**
 * Creates the document folder template system: templates, template items,
 * entity folder initialization tracking, and default-per-entity-type constraint.
 *
 * Combines:
 *  - create_document_folder_templates_table
 *  - create_document_folder_template_items_table
 *  - create_document_entity_folder_init_table
 *  - add_document_folder_templates_default_partial_unique_index
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
async function distributeIfCitus(knex, tableName) {
  const citusFn = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS exists;
  `);

  if (citusFn.rows?.[0]?.exists) {
    const alreadyDistributed = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition
        WHERE logicalrelid = '${tableName}'::regclass
      ) AS is_distributed;
    `);

    if (!alreadyDistributed.rows?.[0]?.is_distributed) {
      await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant')`);
    }
  }
}

exports.up = async function up(knex) {
  // --- Step 1: Create document_folder_templates ---
  if (!(await knex.schema.hasTable('document_folder_templates'))) {
    await knex.schema.createTable('document_folder_templates', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('template_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.text('name').notNullable();
      table.text('entity_type').notNullable();
      table.boolean('is_default').notNullable().defaultTo(false);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.uuid('created_by');
      table.uuid('updated_by');

      table.primary(['tenant', 'template_id']);
      table.foreign('tenant').references('tenant').inTable('tenants');

      table.index(['tenant', 'entity_type'], 'idx_doc_folder_templates_tenant_entity_type');
      table.index(['tenant', 'is_default'], 'idx_doc_folder_templates_tenant_is_default');
      table.unique(['tenant', 'entity_type', 'name'], 'uq_doc_folder_templates_tenant_entity_type_name');
    });
  }

  await distributeIfCitus(knex, 'document_folder_templates');

  // --- Step 2: Create document_folder_template_items ---
  if (!(await knex.schema.hasTable('document_folder_template_items'))) {
    await knex.schema.createTable('document_folder_template_items', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('template_item_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('template_id').notNullable();
      table.uuid('parent_template_item_id');
      table.text('folder_name').notNullable();
      table.text('folder_path').notNullable();
      table.integer('sort_order').notNullable().defaultTo(0);
      table.boolean('is_client_visible').notNullable().defaultTo(false);
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.uuid('created_by');
      table.uuid('updated_by');

      table.primary(['tenant', 'template_item_id']);

      table
        .foreign('tenant')
        .references('tenant')
        .inTable('tenants');

      table
        .foreign(['tenant', 'template_id'])
        .references(['tenant', 'template_id'])
        .inTable('document_folder_templates')
        .onDelete('CASCADE');

      // No self-referential FK for parent_template_item_id — unsupported on CitusDB distributed tables.
      // Parent-child tree relationship enforced at application level.

      table.index(['tenant', 'template_id'], 'idx_doc_folder_template_items_tenant_template_id');
      table.index(['tenant', 'parent_template_item_id'], 'idx_doc_folder_template_items_tenant_parent_item_id');
      table.unique(['tenant', 'template_id', 'folder_path'], 'uq_doc_folder_template_items_tenant_template_path');
    });
  }

  await distributeIfCitus(knex, 'document_folder_template_items');

  // --- Step 3: Create document_entity_folder_init ---
  if (!(await knex.schema.hasTable('document_entity_folder_init'))) {
    await knex.schema.createTable('document_entity_folder_init', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('entity_folder_init_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('entity_id').notNullable();
      table.text('entity_type').notNullable();
      table.uuid('initialized_from_template_id');
      table.timestamp('initialized_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
      table.uuid('created_by');
      table.uuid('updated_by');

      table.primary(['tenant', 'entity_folder_init_id']);

      table
        .foreign('tenant')
        .references('tenant')
        .inTable('tenants');

      table
        .foreign(['tenant', 'initialized_from_template_id'])
        .references(['tenant', 'template_id'])
        .inTable('document_folder_templates')
        .onDelete('SET NULL');

      table.unique(['tenant', 'entity_type', 'entity_id'], 'uq_doc_entity_folder_init_tenant_entity_scope');
      table.index(['tenant', 'entity_type', 'entity_id'], 'idx_doc_entity_folder_init_tenant_entity_scope');
      table.index(['tenant', 'initialized_from_template_id'], 'idx_doc_entity_folder_init_tenant_template');
    });
  }

  await distributeIfCitus(knex, 'document_entity_folder_init');

  // --- Step 4: Partial unique index ensuring one default template per entity type ---
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_folder_templates_default_per_entity_type
    ON document_folder_templates (tenant, entity_type)
    WHERE is_default = true
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS uq_doc_folder_templates_default_per_entity_type');
  await knex.schema.dropTableIfExists('document_entity_folder_init');
  await knex.schema.dropTableIfExists('document_folder_template_items');
  await knex.schema.dropTableIfExists('document_folder_templates');
};

// CitusDB: create_distributed_table cannot run inside a transaction
exports.config = { transaction: false };
