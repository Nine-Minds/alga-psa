const OWNER_CLIENT_FK = 'contracts_owner_client_id_fkey';
const OWNER_CLIENT_INDEX = 'idx_contracts_tenant_owner_client_id';

const ensureSequentialMode = async (knex) => {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'citus'
      ) THEN
        EXECUTE 'SET citus.multi_shard_modify_mode TO ''sequential''';
      END IF;
    END $$;
  `);
};

const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch (error) {
    console.warn(`Unable to check column ${columnName} on ${tableName}:`, error);
    return false;
  }
};

const hasConstraint = async (knex, constraintName) => {
  try {
    const row = await knex('pg_constraint')
      .select('conname')
      .where({ conname: constraintName })
      .first();
    return Boolean(row);
  } catch (error) {
    console.warn(`Unable to check constraint ${constraintName}:`, error);
    return false;
  }
};

const hasIndex = async (knex, indexName) => {
  try {
    const row = await knex('pg_indexes')
      .select('indexname')
      .where({ indexname: indexName })
      .first();
    return Boolean(row);
  } catch (error) {
    console.warn(`Unable to check index ${indexName}:`, error);
    return false;
  }
};

exports.up = async function up(knex) {
  await ensureSequentialMode(knex);

  const tableName = 'contracts';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ Skipping contract owner migration: contracts table not found');
    return;
  }

  const ownerClientColumnExists = await hasColumn(knex, tableName, 'owner_client_id');
  if (!ownerClientColumnExists) {
    await knex.schema.alterTable(tableName, (table) => {
      table.uuid('owner_client_id').nullable();
    });
  }

  if (!await hasIndex(knex, OWNER_CLIENT_INDEX)) {
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS ${OWNER_CLIENT_INDEX}
      ON ${tableName} (tenant, owner_client_id);
    `);
  }

  if (!await hasConstraint(knex, OWNER_CLIENT_FK)) {
    await knex.raw(`
      ALTER TABLE ${tableName}
      ADD CONSTRAINT ${OWNER_CLIENT_FK}
      FOREIGN KEY (tenant, owner_client_id)
      REFERENCES clients(tenant, client_id);
    `);
  }

  console.log('✓ Added contracts.owner_client_id for client-owned contract migration');
};

exports.down = async function down(knex) {
  await ensureSequentialMode(knex);

  const tableName = 'contracts';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ contracts table not found, nothing to roll back');
    return;
  }

  if (await hasConstraint(knex, OWNER_CLIENT_FK)) {
    await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT ${OWNER_CLIENT_FK};`);
  }

  if (await hasIndex(knex, OWNER_CLIENT_INDEX)) {
    await knex.raw(`DROP INDEX IF EXISTS ${OWNER_CLIENT_INDEX};`);
  }

  if (await hasColumn(knex, tableName, 'owner_client_id')) {
    await knex.schema.alterTable(tableName, (table) => {
      table.dropColumn('owner_client_id');
    });
  }

  console.log('✓ Removed contracts.owner_client_id');
};

exports.config = { transaction: false };
