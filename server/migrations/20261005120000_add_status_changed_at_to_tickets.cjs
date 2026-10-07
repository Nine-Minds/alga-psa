/**
 * tickets.status_changed_at: when the ticket entered its current status.
 *
 * Anchor of the `ticket.status_age` date trigger ("ticket has been in status S for N days").
 * Application code keeps it current (shared/lib/ticketStatusClock.ts): it is set to now() whenever
 * status_id actually changes. The tickets table is Citus-distributed and DB triggers on it were
 * removed on purpose (20250212094500_remove_ticket_number_trigger.cjs), so there is no trigger.
 *
 * The column default (now()) covers every INSERT path. The column is nullable so the backfill can be
 * re-run; readers COALESCE it with entered_at.
 *
 * Backfill, per ticket, first match wins:
 *   1. the latest ticket_audit_logs row whose curated `changes.status_id.new` equals the ticket's
 *      current status_id (event types TICKET_STATUS_CHANGED, TICKET_CLOSED, TICKET_REOPENED and
 *      TICKET_UPDATED all carry that diff; audit logs only exist from 2026-05);
 *   2. tickets.entered_at (the tickets table has no created_at column);
 *   3. the migration timestamp.
 *
 * Citus: the UPDATE runs one tenant at a time, correlates on `tenant`, and binds the final fallback
 * timestamp as a parameter because Citus rejects volatile now() inside COALESCE in UPDATEs on
 * distributed tables (see 20260803120000_backfill_sla_state_for_tickets_created_paused_or_closed.cjs).
 */

const INDEX_NAME = 'idx_tickets_tenant_status_status_changed_at';

async function backfillTicketStatusChangedAt(knex, fallbackTimestamp = new Date().toISOString()) {
  const hasAuditLogs = await knex.schema.hasTable('ticket_audit_logs');
  const auditSubquery = hasAuditLogs
    ? `(SELECT MAX(l.occurred_at)
          FROM ticket_audit_logs l
         WHERE l.tenant = t.tenant
           AND l.ticket_id = t.ticket_id
           AND l.changes -> 'status_id' ->> 'new' = t.status_id::text)`
    : 'NULL::timestamptz';
  const tenants = await knex('tenants').select('tenant');
  let updated = 0;
  for (const { tenant } of tenants) {
    const result = await knex.raw(
      `UPDATE tickets t
          SET status_changed_at = COALESCE(${auditSubquery}, t.entered_at, ?::timestamptz)
        WHERE t.tenant = ?
          AND t.status_changed_at IS NULL`,
      [fallbackTimestamp, tenant]
    );
    updated += result.rowCount ?? 0;
  }
  return updated;
}

exports.backfillTicketStatusChangedAt = backfillTicketStatusChangedAt;

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('tickets'))) return;
  await knex.raw('ALTER TABLE tickets ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NULL');
  // Set the default before the backfill so rows inserted while it runs are stamped, not left NULL.
  await knex.raw('ALTER TABLE tickets ALTER COLUMN status_changed_at SET DEFAULT now()');
  await backfillTicketStatusChangedAt(knex);
  // Supports the status-age scan: tenant + status, range on the entry time.
  await knex.raw(`CREATE INDEX IF NOT EXISTS ${INDEX_NAME} ON tickets (tenant, status_id, status_changed_at)`);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('tickets'))) return;
  await knex.raw(`DROP INDEX IF EXISTS ${INDEX_NAME}`);
  await knex.raw('ALTER TABLE tickets DROP COLUMN IF EXISTS status_changed_at');
};
