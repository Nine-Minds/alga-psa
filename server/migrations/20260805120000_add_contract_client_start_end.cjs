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

exports.up = async function up(knex) {
  await ensureSequentialMode(knex);

  const tableName = 'contracts';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ Skipping contract start/end migration: contracts table not found');
    return;
  }

  for (const column of ['start_date', 'end_date']) {
    if (!await hasColumn(knex, tableName, column)) {
      await knex.schema.alterTable(tableName, (table) => {
        // timestamptz so caller-supplied instants round-trip without a
        // server-local UTC-offset shift on read/write.
        table.timestamp(column, { useTz: true }).nullable();
      });
    }
  }

  console.log('✓ Added contracts.start_date, contracts.end_date');
};

exports.down = async function down(knex) {
  await ensureSequentialMode(knex);

  const tableName = 'contracts';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ contracts table not found, nothing to roll back');
    return;
  }

  for (const column of ['start_date', 'end_date']) {
    if (await hasColumn(knex, tableName, column)) {
      await knex.schema.alterTable(tableName, (table) => {
        table.dropColumn(column);
      });
    }
  }

  console.log('✓ Removed contracts.start_date, contracts.end_date');
};

exports.config = { transaction: false };
