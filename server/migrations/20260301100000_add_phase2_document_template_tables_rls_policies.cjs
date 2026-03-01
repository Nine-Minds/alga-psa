/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const tables = [
    'document_folder_templates',
    'document_folder_template_items',
    'document_entity_folder_init',
  ];

  for (const tableName of tables) {
    const hasTable = await knex.schema.hasTable(tableName);
    if (!hasTable) {
      continue;
    }

    await knex.raw(`
      ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS tenant_isolation_policy ON ${tableName};
      CREATE POLICY tenant_isolation_policy ON ${tableName}
        USING (tenant = current_setting('app.current_tenant')::uuid);

      DROP POLICY IF EXISTS tenant_isolation_insert_policy ON ${tableName};
      CREATE POLICY tenant_isolation_insert_policy ON ${tableName}
        FOR INSERT WITH CHECK (tenant = current_setting('app.current_tenant')::uuid);
    `);
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const tables = [
    'document_folder_templates',
    'document_folder_template_items',
    'document_entity_folder_init',
  ];

  for (const tableName of tables) {
    const hasTable = await knex.schema.hasTable(tableName);
    if (!hasTable) {
      continue;
    }

    await knex.raw(`
      DROP POLICY IF EXISTS tenant_isolation_insert_policy ON ${tableName};
      DROP POLICY IF EXISTS tenant_isolation_policy ON ${tableName};
      ALTER TABLE ${tableName} DISABLE ROW LEVEL SECURITY;
    `);
  }
};
