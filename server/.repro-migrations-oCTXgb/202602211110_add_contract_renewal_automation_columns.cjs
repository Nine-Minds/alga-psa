const RENEWAL_POLICY_CONSTRAINT = 'client_contracts_renewal_due_date_action_policy_check';

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
    console.log('⊘ Skipping renewal automation migration: client_contracts table not found');
    return;
  }

  const [
    hasCreatedTicketId,
    hasAutomationError,
    hasRenewalDueDateActionPolicy,
    hasRenewalTicketBoardId,
    hasRenewalTicketStatusId,
    hasRenewalTicketPriority,
    hasRenewalTicketAssigneeId,
    hasCreatedDraftContractId,
  ] = await Promise.all([
    hasColumn(knex, tableName, 'created_ticket_id'),
    hasColumn(knex, tableName, 'automation_error'),
    hasColumn(knex, tableName, 'renewal_due_date_action_policy'),
    hasColumn(knex, tableName, 'renewal_ticket_board_id'),
    hasColumn(knex, tableName, 'renewal_ticket_status_id'),
    hasColumn(knex, tableName, 'renewal_ticket_priority'),
    hasColumn(knex, tableName, 'renewal_ticket_assignee_id'),
    hasColumn(knex, tableName, 'created_draft_contract_id'),
  ]);

  if (
    !hasCreatedTicketId ||
    !hasAutomationError ||
    !hasRenewalDueDateActionPolicy ||
    !hasRenewalTicketBoardId ||
    !hasRenewalTicketStatusId ||
    !hasRenewalTicketPriority ||
    !hasRenewalTicketAssigneeId ||
    !hasCreatedDraftContractId
  ) {
    await knex.schema.alterTable(tableName, (table) => {
      if (!hasCreatedTicketId) {
        table.uuid('created_ticket_id').nullable();
      }
      if (!hasAutomationError) {
        table.text('automation_error').nullable();
      }
      if (!hasRenewalDueDateActionPolicy) {
        table.text('renewal_due_date_action_policy').nullable();
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
      if (!hasCreatedDraftContractId) {
        table.uuid('created_draft_contract_id').nullable();
      }
    });
  }

  const hasPolicyConstraint = await hasConstraint(knex, RENEWAL_POLICY_CONSTRAINT);
  if (!hasPolicyConstraint) {
    await knex.raw(`
      ALTER TABLE ${tableName}
      ADD CONSTRAINT ${RENEWAL_POLICY_CONSTRAINT}
      CHECK (renewal_due_date_action_policy IN ('queue_only', 'create_ticket'));
    `);
  }

  console.log('✓ Added renewal automation columns to client_contracts');
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
    hasCreatedTicketId,
    hasAutomationError,
    hasRenewalDueDateActionPolicy,
    hasRenewalTicketBoardId,
    hasRenewalTicketStatusId,
    hasRenewalTicketPriority,
    hasRenewalTicketAssigneeId,
    hasCreatedDraftContractId,
  ] = await Promise.all([
    hasColumn(knex, tableName, 'created_ticket_id'),
    hasColumn(knex, tableName, 'automation_error'),
    hasColumn(knex, tableName, 'renewal_due_date_action_policy'),
    hasColumn(knex, tableName, 'renewal_ticket_board_id'),
    hasColumn(knex, tableName, 'renewal_ticket_status_id'),
    hasColumn(knex, tableName, 'renewal_ticket_priority'),
    hasColumn(knex, tableName, 'renewal_ticket_assignee_id'),
    hasColumn(knex, tableName, 'created_draft_contract_id'),
  ]);

  if (await hasConstraint(knex, RENEWAL_POLICY_CONSTRAINT)) {
    await knex.raw(`ALTER TABLE ${tableName} DROP CONSTRAINT ${RENEWAL_POLICY_CONSTRAINT};`);
  }

  if (
    !hasCreatedTicketId &&
    !hasAutomationError &&
    !hasRenewalDueDateActionPolicy &&
    !hasRenewalTicketBoardId &&
    !hasRenewalTicketStatusId &&
    !hasRenewalTicketPriority &&
    !hasRenewalTicketAssigneeId &&
    !hasCreatedDraftContractId
  ) {
    console.log('⊘ Renewal automation columns already absent, nothing to roll back');
    return;
  }

  await knex.schema.alterTable(tableName, (table) => {
    if (hasCreatedDraftContractId) {
      table.dropColumn('created_draft_contract_id');
    }
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
    if (hasAutomationError) {
      table.dropColumn('automation_error');
    }
    if (hasCreatedTicketId) {
      table.dropColumn('created_ticket_id');
    }
  });

  console.log('✓ Removed renewal automation columns from client_contracts');
};

exports.config = { transaction: false };
