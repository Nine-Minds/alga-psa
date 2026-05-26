/**
 * Create ticket_audit_logs table
 *
 * Operational, user-facing ticket activity timeline (not a compliance-grade
 * immutable ledger). Captures comments, internal notes, customer replies,
 * curated field changes, lifecycle transitions, inbound-email source actions,
 * and document activity in one tenant/ticket-scoped stream.
 *
 * See ee/docs/plans/2026-05-25-ticket-audit-logs/PRD.md for design intent.
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

exports.up = async function (knex) {
  console.log('Creating ticket_audit_logs table...');

  if (!(await knex.schema.hasTable('ticket_audit_logs'))) {
    await knex.schema.createTable('ticket_audit_logs', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('audit_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();

      table.uuid('ticket_id').notNullable()
        .comment('The ticket this activity entry belongs to.');

      table.string('event_type', 64).notNullable()
        .comment('Event name aligned with ticket domain events where practical (e.g., TICKET_CREATED, TICKET_STATUS_CHANGED, TICKET_COMMENT_ADDED).');

      table.string('entity_type', 32).notNullable()
        .comment('Type of related entity: ticket, comment, document, email, system.');

      table.string('entity_id', 128).nullable()
        .comment('Optional identifier of the related entity (comment_id, document_id, etc.).');

      table.string('actor_type', 32).notNullable()
        .comment('Actor classification: user, contact, system, api, email_sender, workflow.');

      table.uuid('actor_user_id').nullable()
        .comment('User ID of the actor when actor_type=user.');

      table.uuid('actor_contact_id').nullable()
        .comment('Contact ID of the actor when actor_type=contact or email_sender.');

      table.string('actor_display_name', 256).nullable()
        .comment('Best-effort cached display name for the actor (not required for correctness).');

      table.string('source', 32).notNullable()
        .comment('Origin: ui, api, client_portal, inbound_email, workflow, system.');

      table.timestamp('occurred_at', { useTz: true }).notNullable()
        .comment('When the event actually occurred (may differ from created_at if backdated by source).');

      table.jsonb('changes').notNullable().defaultTo('{}')
        .comment('Structured old/new diffs for field changes. Curated to user-meaningful fields only.');

      table.jsonb('details').notNullable().defaultTo('{}')
        .comment('Free-form event metadata (e.g., inbound email message_id, comment preview, document name). Must not contain raw email bodies or full old/new comment bodies.');

      table.timestamp('created_at', { useTz: true })
        .defaultTo(knex.fn.now())
        .notNullable();

      table.primary(['tenant', 'audit_id']);

      table.foreign('tenant').references('tenant').inTable('tenants');

      // Primary lookup pattern: list activity for a ticket newest-first.
      table.index(['tenant', 'ticket_id', 'occurred_at', 'audit_id'], 'ticket_audit_logs_ticket_time_idx');
    });
  }

  await distributeIfCitus(knex, 'ticket_audit_logs');

  // Composite FK to tickets — same pattern as sla_audit_log. Allow
  // detach-on-delete behavior to preserve history if the ticket is removed.
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ticket_audit_logs_ticket_fkey'
      ) THEN
        ALTER TABLE ticket_audit_logs
          ADD CONSTRAINT ticket_audit_logs_ticket_fkey
          FOREIGN KEY (tenant, ticket_id)
          REFERENCES tickets(tenant, ticket_id);
      END IF;
    END $$;
  `);

  // Optional FK on actor_user_id (nullable) — MATCH SIMPLE skips when null.
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ticket_audit_logs_actor_user_fkey'
      ) THEN
        ALTER TABLE ticket_audit_logs
          ADD CONSTRAINT ticket_audit_logs_actor_user_fkey
          FOREIGN KEY (tenant, actor_user_id)
          REFERENCES users(tenant, user_id);
      END IF;
    END $$;
  `);

  await knex.raw(`
    COMMENT ON TABLE ticket_audit_logs IS 'Operational ticket activity timeline (v1, not compliance-grade). See ee/docs/plans/2026-05-25-ticket-audit-logs/PRD.md.';
  `);

  console.log('ticket_audit_logs table created');
};

exports.down = async function (knex) {
  console.log('Dropping ticket_audit_logs table...');
  await knex.schema.dropTableIfExists('ticket_audit_logs');
  console.log('ticket_audit_logs table dropped');
};

// Citus requires FK manipulation to run outside a transaction block.
exports.config = { transaction: false };
