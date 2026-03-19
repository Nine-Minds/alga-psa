/**
 * Adds entity_id/entity_type columns to document_folders, fixes PK for CitusDB,
 * and replaces uniqueness constraint to allow entity-scoped folder paths.
 *
 * Combines:
 *  - add_entity_scope_to_document_folders
 *  - expand_document_folder_uniqueness_to_entity_scope
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
  const hasTable = await knex.schema.hasTable('document_folders');
  if (!hasTable) {
    return;
  }

  // --- Step 1: Add entity_id and entity_type columns ---
  const hasEntityId = await knex.schema.hasColumn('document_folders', 'entity_id');
  const hasEntityType = await knex.schema.hasColumn('document_folders', 'entity_type');

  if (!hasEntityId || !hasEntityType) {
    await knex.schema.alterTable('document_folders', (table) => {
      if (!hasEntityId) {
        table.uuid('entity_id').nullable();
      }

      if (!hasEntityType) {
        table.text('entity_type').nullable();
      }
    });
  }

  // --- Step 2: Fix primary key for CitusDB (distribution column must be in PK) ---
  const pkResult = await knex.raw(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'document_folders'::regclass AND contype = 'p'
  `);
  const pkName = pkResult.rows?.[0]?.conname;

  if (pkName) {
    const pkCols = await knex.raw(`
      SELECT a.attname FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.conname = ? AND c.conrelid = 'document_folders'::regclass
    `, [pkName]);
    const colNames = pkCols.rows.map((r) => r.attname);

    if (!colNames.includes('tenant')) {
      // Drop self-referential FK on parent_folder_id (not tenant-scoped, incompatible with CitusDB)
      const fks = await knex.raw(`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'document_folders'::regclass
        AND contype = 'f'
        AND confrelid = 'document_folders'::regclass
      `);
      for (const fk of fks.rows) {
        await knex.raw(`ALTER TABLE document_folders DROP CONSTRAINT IF EXISTS "${fk.conname}"`);
      }
      // Self-referential relationship (parent_folder_id) enforced at application level

      // Drop old single-column PK and add composite PK
      await knex.raw(`ALTER TABLE document_folders DROP CONSTRAINT IF EXISTS "${pkName}" CASCADE`);
      await knex.raw(`ALTER TABLE document_folders ADD CONSTRAINT "${pkName}" PRIMARY KEY (tenant, folder_id)`);
    }
  }

  await distributeIfCitus(knex, 'document_folders');

  // --- Step 3: Replace uniqueness constraint with entity-scoped version ---
  await knex.raw(`
    ALTER TABLE document_folders
    DROP CONSTRAINT IF EXISTS uq_document_folders_tenant_path;
  `);

  await knex.raw(`
    DROP INDEX IF EXISTS uq_document_folders_tenant_path;
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_document_folders_tenant_path_entity_scope
    ON document_folders (
      tenant,
      folder_path,
      COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::uuid),
      COALESCE(entity_type, '')
    );
  `);
};

exports.config = { transaction: false };

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('document_folders');
  if (!hasTable) {
    return;
  }

  // Reverse step 3: restore original uniqueness constraint
  await knex.raw(`
    DROP INDEX IF EXISTS uq_document_folders_tenant_path_entity_scope;
  `);

  const duplicatePaths = await knex.raw(`
    SELECT EXISTS (
      SELECT 1
      FROM document_folders
      GROUP BY tenant, folder_path
      HAVING COUNT(*) > 1
    ) AS has_duplicates;
  `);

  if (duplicatePaths.rows?.[0]?.has_duplicates) {
    throw new Error(
      'Cannot rollback: duplicate (tenant, folder_path) rows exist due to entity-scoped folders. ' +
      'Remove entity-scoped duplicate rows before retrying rollback.'
    );
  }

  await knex.raw(`
    ALTER TABLE document_folders
    ADD CONSTRAINT uq_document_folders_tenant_path
    UNIQUE (tenant, folder_path);
  `);

  // Reverse step 1: drop entity columns
  const hasEntityId = await knex.schema.hasColumn('document_folders', 'entity_id');
  const hasEntityType = await knex.schema.hasColumn('document_folders', 'entity_type');

  if (!hasEntityId && !hasEntityType) {
    return;
  }

  await knex.schema.alterTable('document_folders', (table) => {
    if (hasEntityType) {
      table.dropColumn('entity_type');
    }

    if (hasEntityId) {
      table.dropColumn('entity_id');
    }
  });
};
