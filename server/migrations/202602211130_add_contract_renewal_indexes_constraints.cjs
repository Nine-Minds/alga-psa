const INDEX_DECISION_DUE_STATUS = 'idx_client_contracts_renewal_due_status';
const INDEX_OWNER_STATUS = 'idx_client_contracts_renewal_owner_status';
const INDEX_MODE_TYPE = 'idx_client_contracts_renewal_mode_type';
const INDEX_SNOOZE = 'idx_client_contracts_renewal_snooze';
const UNIQUE_ACTIVE_CYCLE = 'ux_client_contracts_active_cycle_key';

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

  const tableName = 'client_contracts';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ Skipping renewal index migration: client_contracts table not found');
    return;
  }

  const [
    hasDecisionDueDate,
    hasStatus,
    hasAssignedTo,
    hasRenewalMode,
    hasEndDate,
    hasSnoozedUntil,
    hasRenewalCycleKey,
    hasClientContractId,
    hasIsActive,
  ] = await Promise.all([
    hasColumn(knex, tableName, 'decision_due_date'),
    hasColumn(knex, tableName, 'status'),
    hasColumn(knex, tableName, 'assigned_to'),
    hasColumn(knex, tableName, 'renewal_mode'),
    hasColumn(knex, tableName, 'end_date'),
    hasColumn(knex, tableName, 'snoozed_until'),
    hasColumn(knex, tableName, 'renewal_cycle_key'),
    hasColumn(knex, tableName, 'client_contract_id'),
    hasColumn(knex, tableName, 'is_active'),
  ]);

  if (!hasIsActive) {
    console.log('⊘ Skipping renewal index migration: is_active column not found');
    return;
  }

  if (hasDecisionDueDate && hasStatus) {
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS ${INDEX_DECISION_DUE_STATUS}
      ON ${tableName}(tenant, decision_due_date, status)
      WHERE is_active = true AND decision_due_date IS NOT NULL;
    `);
  }

  if (hasAssignedTo && hasStatus) {
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS ${INDEX_OWNER_STATUS}
      ON ${tableName}(tenant, assigned_to, status)
      WHERE is_active = true;
    `);
  }

  if (hasRenewalMode && hasEndDate) {
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS ${INDEX_MODE_TYPE}
      ON ${tableName}(tenant, renewal_mode, end_date)
      WHERE is_active = true;
    `);
  }

  if (hasStatus && hasSnoozedUntil) {
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS ${INDEX_SNOOZE}
      ON ${tableName}(tenant, status, snoozed_until)
      WHERE is_active = true;
    `);
  }

  if (hasRenewalCycleKey && hasClientContractId) {
    await knex.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS ${UNIQUE_ACTIVE_CYCLE}
      ON ${tableName}(tenant, client_contract_id, renewal_cycle_key)
      WHERE is_active = true AND renewal_cycle_key IS NOT NULL;
    `);
  }

  console.log('✓ Added renewal indexes/constraints on client_contracts');
};

exports.down = async function down(knex) {
  await ensureSequentialMode(knex);

  const tableName = 'client_contracts';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ client_contracts table not found, nothing to roll back');
    return;
  }

  await knex.raw(`DROP INDEX IF EXISTS ${UNIQUE_ACTIVE_CYCLE};`);
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX_SNOOZE};`);
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX_MODE_TYPE};`);
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX_OWNER_STATUS};`);
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX_DECISION_DUE_STATUS};`);

  console.log('✓ Removed renewal indexes/constraints from client_contracts');
};

exports.config = { transaction: false };
