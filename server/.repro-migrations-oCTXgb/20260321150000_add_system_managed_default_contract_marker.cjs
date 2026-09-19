const DEFAULT_MARKER_COLUMN = 'is_system_managed_default';
const DEFAULT_UNIQUE_INDEX = 'contracts_system_managed_default_unique_per_client';

const hasColumn = async (knex, tableName, columnName) => {
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) return false;
  return knex.schema.hasColumn(tableName, columnName);
};

exports.up = async function up(knex) {
  const contractsExists = await knex.schema.hasTable('contracts');
  if (!contractsExists) {
    return;
  }

  if (!await hasColumn(knex, 'contracts', DEFAULT_MARKER_COLUMN)) {
    await knex.schema.alterTable('contracts', (table) => {
      table.boolean(DEFAULT_MARKER_COLUMN).notNullable().defaultTo(false);
    });
  }

  await knex('contracts')
    .whereNull(DEFAULT_MARKER_COLUMN)
    .update({ [DEFAULT_MARKER_COLUMN]: false });

  const hasOwnerClientId = await hasColumn(knex, 'contracts', 'owner_client_id');
  const hasIsTemplate = await hasColumn(knex, 'contracts', 'is_template');
  if (hasOwnerClientId) {
    const nonTemplatePredicate = hasIsTemplate
      ? "(is_template IS NULL OR is_template = false)"
      : 'TRUE';
    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS ${DEFAULT_UNIQUE_INDEX}
      ON contracts (tenant, owner_client_id)
      WHERE ${DEFAULT_MARKER_COLUMN} = true
        AND owner_client_id IS NOT NULL
        AND ${nonTemplatePredicate}
    `);
  }
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS ${DEFAULT_UNIQUE_INDEX}`);

  if (await hasColumn(knex, 'contracts', DEFAULT_MARKER_COLUMN)) {
    await knex.schema.alterTable('contracts', (table) => {
      table.dropColumn(DEFAULT_MARKER_COLUMN);
    });
  }
};
