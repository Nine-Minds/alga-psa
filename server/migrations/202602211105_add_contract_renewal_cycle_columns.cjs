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
    console.log('⊘ Skipping renewal cycle migration: client_contracts table not found');
    return;
  }

  const [hasDecisionDueDate, hasRenewalCycleStart, hasRenewalCycleEnd, hasRenewalCycleKey] = await Promise.all([
    hasColumn(knex, tableName, 'decision_due_date'),
    hasColumn(knex, tableName, 'renewal_cycle_start'),
    hasColumn(knex, tableName, 'renewal_cycle_end'),
    hasColumn(knex, tableName, 'renewal_cycle_key'),
  ]);

  if (!hasDecisionDueDate || !hasRenewalCycleStart || !hasRenewalCycleEnd || !hasRenewalCycleKey) {
    await knex.schema.alterTable(tableName, (table) => {
      if (!hasDecisionDueDate) {
        table.date('decision_due_date').nullable();
      }
      if (!hasRenewalCycleStart) {
        table.date('renewal_cycle_start').nullable();
      }
      if (!hasRenewalCycleEnd) {
        table.date('renewal_cycle_end').nullable();
      }
      if (!hasRenewalCycleKey) {
        table.text('renewal_cycle_key').nullable();
      }
    });

    console.log('✓ Added renewal cycle columns to client_contracts');
    return;
  }

  console.log('⊘ Renewal cycle columns already present on client_contracts, skipping');
};

exports.down = async function down(knex) {
  await ensureSequentialMode(knex);

  const tableName = 'client_contracts';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ client_contracts table not found, nothing to roll back');
    return;
  }

  const [hasDecisionDueDate, hasRenewalCycleStart, hasRenewalCycleEnd, hasRenewalCycleKey] = await Promise.all([
    hasColumn(knex, tableName, 'decision_due_date'),
    hasColumn(knex, tableName, 'renewal_cycle_start'),
    hasColumn(knex, tableName, 'renewal_cycle_end'),
    hasColumn(knex, tableName, 'renewal_cycle_key'),
  ]);

  if (!hasDecisionDueDate && !hasRenewalCycleStart && !hasRenewalCycleEnd && !hasRenewalCycleKey) {
    console.log('⊘ Renewal cycle columns already absent, nothing to roll back');
    return;
  }

  await knex.schema.alterTable(tableName, (table) => {
    if (hasRenewalCycleKey) {
      table.dropColumn('renewal_cycle_key');
    }
    if (hasRenewalCycleEnd) {
      table.dropColumn('renewal_cycle_end');
    }
    if (hasRenewalCycleStart) {
      table.dropColumn('renewal_cycle_start');
    }
    if (hasDecisionDueDate) {
      table.dropColumn('decision_due_date');
    }
  });

  console.log('✓ Removed renewal cycle columns from client_contracts');
};

exports.config = { transaction: false };
