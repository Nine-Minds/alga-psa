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

  await distributeIfCitus(knex, 'document_folders');
};

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
