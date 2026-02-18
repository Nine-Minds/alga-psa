/**
 * Add board manager support and SLA notification tracking tables.
 *
 * Changes:
 * 1. Add manager_user_id to boards table for board-level escalation manager
 * 2. Create sla_notification_thresholds table for configuring when/who to notify
 * 3. Create sla_notifications_sent table to prevent duplicate notifications
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. Add manager_user_id to boards table
  await knex.schema.alterTable('boards', (table) => {
    table.uuid('manager_user_id').nullable();
  });

  // Add foreign key constraint (separate statement for Citus compatibility)
  // Note: ON DELETE SET NULL is not supported in CitusDB, so cleanup is handled
  // at the application level in userActions.ts
  await knex.schema.alterTable('boards', (table) => {
    table.foreign(['tenant', 'manager_user_id'])
      .references(['tenant', 'user_id'])
      .inTable('users');
  });

  // Add index for efficient lookups by manager
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_boards_manager_user_id
    ON boards (tenant, manager_user_id);
  `);

  // 2. Create sla_notification_thresholds table
  await knex.schema.createTable('sla_notification_thresholds', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('threshold_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('sla_policy_id').notNullable();
    table.integer('threshold_percent').notNullable();
    table.text('notification_type').notNullable().defaultTo('warning');
    table.boolean('notify_assignee').defaultTo(true);
    table.boolean('notify_board_manager').defaultTo(false);
    table.boolean('notify_escalation_manager').defaultTo(false);
    table.specificType('channels', 'TEXT[]').defaultTo(knex.raw("ARRAY['in_app']"));
    table.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());

    table.primary(['tenant', 'threshold_id']);
    table.foreign('tenant').references('tenants.tenant');
    // Note: ON DELETE CASCADE is not supported in CitusDB, so cleanup is handled
    // at the application level when deleting SLA policies
    table.foreign(['tenant', 'sla_policy_id'])
      .references(['tenant', 'sla_policy_id'])
      .inTable('sla_policies');
  });

  // Add unique constraint for tenant + policy + threshold percent combination
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sla_notification_thresholds_unique
    ON sla_notification_thresholds (tenant, sla_policy_id, threshold_percent);
  `);

  // Add index for efficient policy lookups
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_sla_notification_thresholds_policy
    ON sla_notification_thresholds (tenant, sla_policy_id);
  `);

  // 3. Create sla_notifications_sent table for duplicate prevention
  await knex.schema.createTable('sla_notifications_sent', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('ticket_id').notNullable();
    table.integer('threshold_percent').notNullable();
    table.timestamp('sent_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'ticket_id', 'threshold_percent']);
    table.foreign('tenant').references('tenants.tenant');
    // Note: ON DELETE CASCADE is not supported in CitusDB, so cleanup is handled
    // at the application level when deleting tickets
    table.foreign(['tenant', 'ticket_id'])
      .references(['tenant', 'ticket_id'])
      .inTable('tickets');
  });

  // Add index for efficient ticket lookups
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_sla_notifications_sent_ticket
    ON sla_notifications_sent (tenant, ticket_id);
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop sla_notifications_sent table
  await knex.raw(`DROP INDEX IF EXISTS idx_sla_notifications_sent_ticket;`);
  await knex.schema.dropTableIfExists('sla_notifications_sent');

  // Drop sla_notification_thresholds table
  await knex.raw(`DROP INDEX IF EXISTS idx_sla_notification_thresholds_policy;`);
  await knex.raw(`DROP INDEX IF EXISTS idx_sla_notification_thresholds_unique;`);
  await knex.schema.dropTableIfExists('sla_notification_thresholds');

  // Remove manager_user_id from boards
  await knex.raw(`DROP INDEX IF EXISTS idx_boards_manager_user_id;`);
  await knex.schema.alterTable('boards', (table) => {
    table.dropForeign(['tenant', 'manager_user_id']);
    table.dropColumn('manager_user_id');
  });
};

// Citus requires ALTER TABLE with foreign key constraints to run outside a transaction block
exports.config = { transaction: false };
