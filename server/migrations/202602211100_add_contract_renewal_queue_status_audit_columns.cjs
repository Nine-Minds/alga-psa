const RENEWAL_STATUS_CONSTRAINT = 'client_contracts_renewal_status_check';
const ASSIGNED_TO_FK = 'client_contracts_assigned_to_fkey';
const LAST_ACTION_BY_FK = 'client_contracts_last_action_by_fkey';

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
    const result = await knex('pg_constraint')
      .select('conname')
      .where({ conname: constraintName })
      .first();
    return Boolean(result);
  } catch (error) {
    console.warn(`Unable to check constraint ${constraintName}:`, error);
    return false;
  }
};

exports.up = async function up(knex) {
  await ensureSequentialMode(knex);

  const tableName = 'client_contracts';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ Skipping renewal queue status/audit migration: client_contracts table not found');
    return;
  }

  const [
    hasStatus,
    hasSnoozedUntil,
    hasAssignedTo,
    hasLastAction,
    hasLastActionBy,
    hasLastActionAt,
    hasLastActionNote,
  ] = await Promise.all([
    hasColumn(knex, tableName, 'status'),
    hasColumn(knex, tableName, 'snoozed_until'),
    hasColumn(knex, tableName, 'assigned_to'),
    hasColumn(knex, tableName, 'last_action'),
    hasColumn(knex, tableName, 'last_action_by'),
    hasColumn(knex, tableName, 'last_action_at'),
    hasColumn(knex, tableName, 'last_action_note'),
  ]);

  if (!hasStatus || !hasSnoozedUntil || !hasAssignedTo || !hasLastAction || !hasLastActionBy || !hasLastActionAt || !hasLastActionNote) {
    await knex.schema.alterTable(tableName, (table) => {
      if (!hasStatus) {
        table.text('status').notNullable().defaultTo('pending');
      }
      if (!hasSnoozedUntil) {
        table.date('snoozed_until').nullable();
      }
      if (!hasAssignedTo) {
        table.uuid('assigned_to').nullable();
      }
      if (!hasLastAction) {
        table.text('last_action').nullable();
      }
      if (!hasLastActionBy) {
        table.uuid('last_action_by').nullable();
      }
      if (!hasLastActionAt) {
        table.timestamp('last_action_at').nullable();
      }
      if (!hasLastActionNote) {
        table.text('last_action_note').nullable();
      }
    });
  }

  const hasRenewalStatusConstraint = await hasConstraint(knex, RENEWAL_STATUS_CONSTRAINT);
  if (!hasRenewalStatusConstraint) {
    await knex.raw(`
      ALTER TABLE ${tableName}
      ADD CONSTRAINT ${RENEWAL_STATUS_CONSTRAINT}
      CHECK (status IN ('pending', 'renewing', 'non_renewing', 'snoozed', 'completed'));
    `);
  }

  const hasAssignedToFk = await hasConstraint(knex, ASSIGNED_TO_FK);
  if (!hasAssignedToFk) {
    await knex.raw(`
      ALTER TABLE ${tableName}
      ADD CONSTRAINT ${ASSIGNED_TO_FK}
      FOREIGN KEY (tenant, assigned_to)
      REFERENCES users(tenant, user_id)
      ON DELETE SET NULL;
    `);
  }

  const hasLastActionByFk = await hasConstraint(knex, LAST_ACTION_BY_FK);
  if (!hasLastActionByFk) {
    await knex.raw(`
      ALTER TABLE ${tableName}
      ADD CONSTRAINT ${LAST_ACTION_BY_FK}
      FOREIGN KEY (tenant, last_action_by)
      REFERENCES users(tenant, user_id)
      ON DELETE SET NULL;
    `);
  }

  console.log('✓ Added renewal queue status/audit columns to client_contracts');
};

exports.down = async function down(knex) {
  await ensureSequentialMode(knex);

  const tableName = 'client_contracts';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ client_contracts table not found, nothing to roll back');
    return;
  }

  const [
    hasStatus,
    hasSnoozedUntil,
    hasAssignedTo,
    hasLastAction,
    hasLastActionBy,
    hasLastActionAt,
    hasLastActionNote,
  ] = await Promise.all([
    hasColumn(knex, tableName, 'status'),
    hasColumn(knex, tableName, 'snoozed_until'),
    hasColumn(knex, tableName, 'assigned_to'),
    hasColumn(knex, tableName, 'last_action'),
    hasColumn(knex, tableName, 'last_action_by'),
    hasColumn(knex, tableName, 'last_action_at'),
    hasColumn(knex, tableName, 'last_action_note'),
  ]);

  if (await hasConstraint(knex, ASSIGNED_TO_FK)) {
    await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT ${ASSIGNED_TO_FK};`);
  }

  if (await hasConstraint(knex, LAST_ACTION_BY_FK)) {
    await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT ${LAST_ACTION_BY_FK};`);
  }

  if (await hasConstraint(knex, RENEWAL_STATUS_CONSTRAINT)) {
    await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT ${RENEWAL_STATUS_CONSTRAINT};`);
  }

  if (!hasStatus && !hasSnoozedUntil && !hasAssignedTo && !hasLastAction && !hasLastActionBy && !hasLastActionAt && !hasLastActionNote) {
    console.log('⊘ Renewal queue status/audit columns already absent, nothing to roll back');
    return;
  }

  await knex.schema.alterTable(tableName, (table) => {
    if (hasLastActionNote) {
      table.dropColumn('last_action_note');
    }
    if (hasLastActionAt) {
      table.dropColumn('last_action_at');
    }
    if (hasLastActionBy) {
      table.dropColumn('last_action_by');
    }
    if (hasLastAction) {
      table.dropColumn('last_action');
    }
    if (hasAssignedTo) {
      table.dropColumn('assigned_to');
    }
    if (hasSnoozedUntil) {
      table.dropColumn('snoozed_until');
    }
    if (hasStatus) {
      table.dropColumn('status');
    }
  });

  console.log('✓ Removed renewal queue status/audit columns from client_contracts');
};

exports.config = { transaction: false };
