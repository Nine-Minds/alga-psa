/**
 * Create SLA audit log table
 *
 * This table provides a complete event history for SLA compliance tracking:
 * - SLA started/paused/resumed events
 * - Threshold warnings (50%, 75%, 90%)
 * - Breach events (100%)
 * - Priority changes affecting SLA targets
 * - Manual overrides
 */

// Helper: distribute a table by tenant if Citus is available
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

exports.up = async function(knex) {
  console.log('Creating sla_audit_log table...');

  if (!(await knex.schema.hasTable('sla_audit_log'))) {
    await knex.schema.createTable('sla_audit_log', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('log_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();

      table.uuid('ticket_id')
        .notNullable()
        .comment('The ticket this event relates to');

      table.string('event_type', 50)
        .notNullable()
        .comment('Type of SLA event: sla_started, sla_paused, sla_resumed, threshold_warning, sla_breach, response_recorded, resolution_recorded, priority_changed, policy_changed, manual_override');

      table.jsonb('event_data')
        .nullable()
        .comment('Additional event data (threshold %, old/new values, etc.)');

      table.uuid('triggered_by')
        .nullable()
        .comment('User who triggered this event (null for system-triggered events)');

      table.timestamp('created_at', { useTz: true })
        .defaultTo(knex.fn.now())
        .notNullable();

      // Primary key must include tenant for Citus
      table.primary(['tenant', 'log_id']);

      // Foreign key to tenants
      table.foreign('tenant').references('tenant').inTable('tenants');

      // Indexes for common queries
      table.index(['tenant', 'ticket_id']);
      table.index(['tenant', 'event_type']);
      table.index(['tenant', 'created_at']);
    });
  }

  // Distribute sla_audit_log for Citus
  await distributeIfCitus(knex, 'sla_audit_log');

  // Add composite foreign keys using raw SQL
  await knex.raw(`
    DO $$ BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'sla_audit_log_ticket_fkey'
        ) THEN
            ALTER TABLE sla_audit_log
            ADD CONSTRAINT sla_audit_log_ticket_fkey
            FOREIGN KEY (tenant, ticket_id)
            REFERENCES tickets(tenant, ticket_id)
            ON DELETE CASCADE;
        END IF;
    END $$;
  `);

  await knex.raw(`
    DO $$ BEGIN
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'sla_audit_log_user_fkey'
        ) THEN
            ALTER TABLE sla_audit_log
            ADD CONSTRAINT sla_audit_log_user_fkey
            FOREIGN KEY (tenant, triggered_by)
            REFERENCES users(tenant, user_id)
            ON DELETE SET NULL;
        END IF;
    END $$;
  `);

  // Add comment to table
  await knex.raw(`
    COMMENT ON TABLE sla_audit_log IS 'Audit log for SLA events - used for compliance reporting and debugging';
  `);

  console.log('sla_audit_log table created');
};

exports.down = async function(knex) {
  console.log('Dropping sla_audit_log table...');
  await knex.schema.dropTableIfExists('sla_audit_log');
  console.log('sla_audit_log table dropped');
};

// Citus requires ALTER TABLE with foreign key constraints to run outside a transaction block
exports.config = { transaction: false };
