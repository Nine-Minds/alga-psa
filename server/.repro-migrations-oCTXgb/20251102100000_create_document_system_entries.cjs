/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable('document_system_entries');
  if (hasTable) {
    return;
  }

  await knex.schema.createTable('document_system_entries', (table) => {
    table.uuid('entry_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();
    table.uuid('file_id').notNullable();
    table.text('category').notNullable();
    table.jsonb('metadata').defaultTo(knex.raw(`'{}'::jsonb`));
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());

    table
      .foreign(['tenant', 'file_id'])
      .references(['tenant', 'file_id'])
      .inTable('external_files');
  });

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS document_system_entries_tenant_category_idx ON document_system_entries (tenant, category)'
  );
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS document_system_entries_file_id_idx ON document_system_entries (file_id)'
  );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('document_system_entries');
  if (!hasTable) {
    return;
  }

  await knex.raw('DROP INDEX IF EXISTS document_system_entries_tenant_category_idx');
  await knex.raw('DROP INDEX IF EXISTS document_system_entries_file_id_idx');
  await knex.schema.dropTable('document_system_entries');
};

