const DEFAULT_RENEWAL_MODE_CONSTRAINT = 'default_billing_settings_default_renewal_mode_check';
const DEFAULT_NOTICE_PERIOD_CONSTRAINT = 'default_billing_settings_default_notice_period_days_check';
const DEFAULT_RENEWAL_POLICY_CONSTRAINT = 'default_billing_settings_renewal_due_date_action_policy_check';

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

  const tableName = 'default_billing_settings';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ Skipping default renewal settings migration: default_billing_settings table not found');
    return;
  }

  const [
    hasDefaultRenewalMode,
    hasDefaultNoticePeriodDays,
    hasRenewalDueDateActionPolicy,
    hasRenewalTicketBoardId,
    hasRenewalTicketStatusId,
    hasRenewalTicketPriority,
    hasRenewalTicketAssigneeId,
  ] = await Promise.all([
    hasColumn(knex, tableName, 'default_renewal_mode'),
    hasColumn(knex, tableName, 'default_notice_period_days'),
    hasColumn(knex, tableName, 'renewal_due_date_action_policy'),
    hasColumn(knex, tableName, 'renewal_ticket_board_id'),
    hasColumn(knex, tableName, 'renewal_ticket_status_id'),
    hasColumn(knex, tableName, 'renewal_ticket_priority'),
    hasColumn(knex, tableName, 'renewal_ticket_assignee_id'),
  ]);

  if (
    !hasDefaultRenewalMode ||
    !hasDefaultNoticePeriodDays ||
    !hasRenewalDueDateActionPolicy ||
    !hasRenewalTicketBoardId ||
    !hasRenewalTicketStatusId ||
    !hasRenewalTicketPriority ||
    !hasRenewalTicketAssigneeId
  ) {
    await knex.schema.alterTable(tableName, (table) => {
      if (!hasDefaultRenewalMode) {
        table.text('default_renewal_mode').notNullable().defaultTo('manual');
      }
      if (!hasDefaultNoticePeriodDays) {
        table.integer('default_notice_period_days').notNullable().defaultTo(30);
      }
      if (!hasRenewalDueDateActionPolicy) {
        table.text('renewal_due_date_action_policy').notNullable().defaultTo('create_ticket');
      }
      if (!hasRenewalTicketBoardId) {
        table.uuid('renewal_ticket_board_id').nullable();
      }
      if (!hasRenewalTicketStatusId) {
        table.uuid('renewal_ticket_status_id').nullable();
      }
      if (!hasRenewalTicketPriority) {
        table.uuid('renewal_ticket_priority').nullable();
      }
      if (!hasRenewalTicketAssigneeId) {
        table.uuid('renewal_ticket_assignee_id').nullable();
      }
    });
  }

  if (!(await hasConstraint(knex, DEFAULT_RENEWAL_MODE_CONSTRAINT))) {
    await knex.raw(`
      ALTER TABLE ${tableName}
      ADD CONSTRAINT ${DEFAULT_RENEWAL_MODE_CONSTRAINT}
      CHECK (default_renewal_mode IN ('none', 'manual', 'auto'));
    `);
  }

  if (!(await hasConstraint(knex, DEFAULT_NOTICE_PERIOD_CONSTRAINT))) {
    await knex.raw(`
      ALTER TABLE ${tableName}
      ADD CONSTRAINT ${DEFAULT_NOTICE_PERIOD_CONSTRAINT}
      CHECK (default_notice_period_days >= 0);
    `);
  }

  if (!(await hasConstraint(knex, DEFAULT_RENEWAL_POLICY_CONSTRAINT))) {
    await knex.raw(`
      ALTER TABLE ${tableName}
      ADD CONSTRAINT ${DEFAULT_RENEWAL_POLICY_CONSTRAINT}
      CHECK (renewal_due_date_action_policy IN ('queue_only', 'create_ticket'));
    `);
  }

  console.log('✓ Added renewal defaults/policy columns to default_billing_settings');
};

exports.down = async function down(knex) {
  await ensureSequentialMode(knex);

  const tableName = 'default_billing_settings';
  const tableExists = await knex.schema.hasTable(tableName);
  if (!tableExists) {
    console.log('⊘ default_billing_settings table not found, nothing to roll back');
    return;
  }

  const [
    hasDefaultRenewalMode,
    hasDefaultNoticePeriodDays,
    hasRenewalDueDateActionPolicy,
    hasRenewalTicketBoardId,
    hasRenewalTicketStatusId,
    hasRenewalTicketPriority,
    hasRenewalTicketAssigneeId,
  ] = await Promise.all([
    hasColumn(knex, tableName, 'default_renewal_mode'),
    hasColumn(knex, tableName, 'default_notice_period_days'),
    hasColumn(knex, tableName, 'renewal_due_date_action_policy'),
    hasColumn(knex, tableName, 'renewal_ticket_board_id'),
    hasColumn(knex, tableName, 'renewal_ticket_status_id'),
    hasColumn(knex, tableName, 'renewal_ticket_priority'),
    hasColumn(knex, tableName, 'renewal_ticket_assignee_id'),
  ]);

  if (await hasConstraint(knex, DEFAULT_RENEWAL_POLICY_CONSTRAINT)) {
    await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT ${DEFAULT_RENEWAL_POLICY_CONSTRAINT};`);
  }
  if (await hasConstraint(knex, DEFAULT_NOTICE_PERIOD_CONSTRAINT)) {
    await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT ${DEFAULT_NOTICE_PERIOD_CONSTRAINT};`);
  }
  if (await hasConstraint(knex, DEFAULT_RENEWAL_MODE_CONSTRAINT)) {
    await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT ${DEFAULT_RENEWAL_MODE_CONSTRAINT};`);
  }

  if (
    !hasDefaultRenewalMode &&
    !hasDefaultNoticePeriodDays &&
    !hasRenewalDueDateActionPolicy &&
    !hasRenewalTicketBoardId &&
    !hasRenewalTicketStatusId &&
    !hasRenewalTicketPriority &&
    !hasRenewalTicketAssigneeId
  ) {
    console.log('⊘ Default renewal settings columns already absent, nothing to roll back');
    return;
  }

  await knex.schema.alterTable(tableName, (table) => {
    if (hasRenewalTicketAssigneeId) {
      table.dropColumn('renewal_ticket_assignee_id');
    }
    if (hasRenewalTicketPriority) {
      table.dropColumn('renewal_ticket_priority');
    }
    if (hasRenewalTicketStatusId) {
      table.dropColumn('renewal_ticket_status_id');
    }
    if (hasRenewalTicketBoardId) {
      table.dropColumn('renewal_ticket_board_id');
    }
    if (hasRenewalDueDateActionPolicy) {
      table.dropColumn('renewal_due_date_action_policy');
    }
    if (hasDefaultNoticePeriodDays) {
      table.dropColumn('default_notice_period_days');
    }
    if (hasDefaultRenewalMode) {
      table.dropColumn('default_renewal_mode');
    }
  });

  console.log('✓ Removed renewal defaults/policy columns from default_billing_settings');
};

exports.config = { transaction: false };
