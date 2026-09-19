/**
 * Allow sla_audit_log.ticket_id to be NULL.
 *
 * The audit log is intended for SLA compliance reporting and debugging
 * (see 20260219000005_create_sla_audit_log.cjs). Hard-deleting audit rows
 * when their ticket is deleted destroys the historical record. Allowing
 * ticket_id to be NULL lets us "detach" rows on ticket delete instead of
 * purging them — the audit row survives, with the original ticket
 * reference preserved in the event_data JSONB.
 *
 * With NOT NULL removed and MATCH SIMPLE FK semantics (the default),
 * NULL on ticket_id is treated as "no reference" so detached rows
 * pass the constraint without it being enforced against tickets.
 */

// Citus + FK manipulation requires statements outside a transaction block.
exports.config = { transaction: false };

exports.up = async function (knex) {
  console.log('Making sla_audit_log.ticket_id nullable...');

  // Idempotency: skip if column is already nullable.
  const nullableCheck = await knex.raw(`
    SELECT is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'sla_audit_log'
       AND column_name = 'ticket_id'
  `);
  if (nullableCheck.rows[0]?.is_nullable === 'YES') {
    console.log('✓ sla_audit_log.ticket_id is already nullable, skipping.');
    return;
  }

  // Step 1: drop the composite FK to tickets so Citus will let us
  // change the column nullability cleanly.
  console.log('  Dropping FK sla_audit_log_ticket_fkey...');
  await knex.raw(`
    ALTER TABLE sla_audit_log
      DROP CONSTRAINT IF EXISTS sla_audit_log_ticket_fkey
  `);

  // Step 2: drop NOT NULL.
  console.log('  Dropping NOT NULL on ticket_id...');
  await knex.raw(`
    ALTER TABLE sla_audit_log
      ALTER COLUMN ticket_id DROP NOT NULL
  `);

  // Step 3: recreate the FK with the same definition. With ticket_id
  // nullable, MATCH SIMPLE means NULLs bypass the FK check, which is
  // exactly the behavior we want for detached audit rows.
  console.log('  Recreating FK sla_audit_log_ticket_fkey...');
  await knex.raw(`
    ALTER TABLE sla_audit_log
      ADD CONSTRAINT sla_audit_log_ticket_fkey
      FOREIGN KEY (tenant, ticket_id)
      REFERENCES tickets(tenant, ticket_id)
  `);

  await knex.raw(`
    COMMENT ON COLUMN sla_audit_log.ticket_id IS
      'The ticket this event relates to. NULL when the original ticket has been deleted; the original ticket id is preserved in event_data._detached_from_ticket_id for forensics.'
  `);

  console.log('✓ sla_audit_log.ticket_id is now nullable');
};

exports.down = async function (knex) {
  console.log('Reverting sla_audit_log.ticket_id to NOT NULL...');

  // Idempotency: skip if column is already NOT NULL.
  const nullableCheck = await knex.raw(`
    SELECT is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'sla_audit_log'
       AND column_name = 'ticket_id'
  `);
  if (nullableCheck.rows[0]?.is_nullable === 'NO') {
    console.log('✓ sla_audit_log.ticket_id is already NOT NULL, skipping.');
    return;
  }

  // Detached rows (ticket_id IS NULL) would block the NOT NULL re-add.
  // Drop them — they're an artifact of the detach-on-delete code path
  // that this migration enables; rolling back implies abandoning that
  // approach. Iterate per-tenant to keep every DELETE tenant-scoped (the
  // project's CitusDB convention requires `tenant` in every WHERE clause
  // on distributed tables).
  const tenantsWithDetached = await knex('sla_audit_log')
    .whereNull('ticket_id')
    .distinct('tenant')
    .pluck('tenant');

  if (tenantsWithDetached.length > 0) {
    console.log(
      `  Removing detached audit rows across ${tenantsWithDetached.length} tenant(s) before re-enabling NOT NULL...`
    );
    for (const tenant of tenantsWithDetached) {
      await knex('sla_audit_log')
        .where({ tenant })
        .whereNull('ticket_id')
        .delete();
    }
  }

  // Drop FK, set NOT NULL, recreate FK.
  await knex.raw(`
    ALTER TABLE sla_audit_log
      DROP CONSTRAINT IF EXISTS sla_audit_log_ticket_fkey
  `);

  await knex.raw(`
    ALTER TABLE sla_audit_log
      ALTER COLUMN ticket_id SET NOT NULL
  `);

  await knex.raw(`
    ALTER TABLE sla_audit_log
      ADD CONSTRAINT sla_audit_log_ticket_fkey
      FOREIGN KEY (tenant, ticket_id)
      REFERENCES tickets(tenant, ticket_id)
  `);

  console.log('✓ sla_audit_log.ticket_id is back to NOT NULL');
};
