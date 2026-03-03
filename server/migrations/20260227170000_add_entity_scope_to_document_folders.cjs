/**
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

  // Fix primary key for CitusDB: distribution column (tenant) must be in PK
  const pkResult = await knex.raw(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'document_folders'::regclass AND contype = 'p'
  `);
  const pkName = pkResult.rows?.[0]?.conname;

  if (pkName) {
    // Check if tenant is already in the PK
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
};

exports.config = { transaction: false };

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable('document_folders');
  if (!hasTable) {
    return;
  }

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
