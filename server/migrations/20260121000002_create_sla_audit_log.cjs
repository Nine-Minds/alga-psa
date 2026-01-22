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

exports.up = async function(knex) {
  console.log('Creating sla_audit_log table...');

  await knex.schema.createTable('sla_audit_log', (table) => {
    table.uuid('log_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant').notNullable();

    table.uuid('ticket_id')
      .notNullable()
      .references('ticket_id')
      .inTable('tickets')
      .onDelete('CASCADE')
      .comment('The ticket this event relates to');

    table.string('event_type', 50)
      .notNullable()
      .comment('Type of SLA event: sla_started, sla_paused, sla_resumed, threshold_warning, sla_breach, response_recorded, resolution_recorded, priority_changed, policy_changed, manual_override');

    table.jsonb('event_data')
      .nullable()
      .comment('Additional event data (threshold %, old/new values, etc.)');

    table.uuid('triggered_by')
      .nullable()
      .references('user_id')
      .inTable('users')
      .onDelete('SET NULL')
      .comment('User who triggered this event (null for system-triggered events)');

    table.timestamp('created_at', { useTz: true })
      .defaultTo(knex.fn.now())
      .notNullable();

    // Indexes for common queries
    table.index(['tenant', 'ticket_id']);
    table.index(['tenant', 'event_type']);
    table.index(['tenant', 'created_at']);
  });

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
