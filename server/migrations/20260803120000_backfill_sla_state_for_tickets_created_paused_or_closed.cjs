/**
 * Backfill SLA state for tickets that were created paused or closed.
 *
 * Until now the SLA timer only reacted to status *changes*, so a ticket that
 * was created directly in a closed status kept a running timer, and a ticket
 * created directly in a pause-configured status burned SLA time until its
 * first status change. Both are fixed at creation time now; this migration
 * repairs the rows that already exist:
 *
 * 1. Tickets whose current status is closed but that never recorded a
 *    resolution get sla_resolution_at stamped (closed_at when known), which
 *    takes them out of the timer job's selection. sla_resolution_met is left
 *    untouched: we do not invent a compliance verdict for historical rows.
 * 2. Tickets whose current status is configured to pause SLA get sla_paused_at
 *    set, so the timer job stops evaluating them until they move on.
 *
 * EE tenants may still have Temporal SLA workflows running for these tickets;
 * those do not observe a DB-only backfill and need operator action.
 */

const AUDIT_CHUNK_SIZE = 500;

async function insertAuditRows(knex, tenant, ticketIds, eventType, eventData) {
  if (ticketIds.length === 0) {
    return;
  }

  const rows = ticketIds.map((ticketId) => ({
    tenant,
    ticket_id: ticketId,
    event_type: eventType,
    event_data: JSON.stringify(eventData),
    triggered_by: null,
  }));

  await knex.batchInsert('sla_audit_log', rows, AUDIT_CHUNK_SIZE);
}

exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');

  let resolvedCount = 0;
  let pausedCount = 0;

  // Citus rejects volatile functions (now()) inside COALESCE/CASE in UPDATEs on
  // distributed tables, so bind the fallback timestamp as a parameter instead.
  const backfillTimestamp = new Date().toISOString();

  for (const { tenant } of tenants) {
    // 1. Neutralize SLA on tickets sitting in a closed status.
    const closed = await knex.raw(
      `UPDATE tickets t
          SET sla_resolution_at = COALESCE(t.closed_at, t.updated_at, t.entered_at, ?::timestamptz)
        WHERE t.tenant = ?
          AND t.sla_policy_id IS NOT NULL
          AND t.sla_resolution_at IS NULL
          AND EXISTS (
            SELECT 1 FROM statuses s
             WHERE s.tenant = t.tenant
               AND s.status_id = t.status_id
               AND s.is_closed = true
          )
        RETURNING t.ticket_id`,
      [backfillTimestamp, tenant]
    );

    const closedTicketIds = (closed.rows || []).map((row) => row.ticket_id);
    resolvedCount += closedTicketIds.length;

    await insertAuditRows(knex, tenant, closedTicketIds, 'resolution_recorded', {
      reason: 'backfill_ticket_in_closed_status',
    });

    // 2. Pause SLA on tickets sitting in a pause-configured status.
    const paused = await knex.raw(
      `UPDATE tickets t
          SET sla_paused_at = ?::timestamptz
        WHERE t.tenant = ?
          AND t.sla_policy_id IS NOT NULL
          AND t.sla_resolution_at IS NULL
          AND t.sla_paused_at IS NULL
          AND EXISTS (
            SELECT 1 FROM status_sla_pause_config c
             WHERE c.tenant = t.tenant
               AND c.status_id = t.status_id
               AND c.pauses_sla = true
          )
        RETURNING t.ticket_id`,
      [backfillTimestamp, tenant]
    );

    const pausedTicketIds = (paused.rows || []).map((row) => row.ticket_id);
    pausedCount += pausedTicketIds.length;

    await insertAuditRows(knex, tenant, pausedTicketIds, 'sla_paused', {
      reason: 'status_pause',
      backfill: 'backfill_ticket_in_pausing_status',
    });
  }

  console.log(
    `SLA backfill: resolved ${resolvedCount} ticket(s) in closed statuses, paused ${pausedCount} ticket(s) in pausing statuses.`
  );
};

exports.down = async function down() {
  // Data backfill only: the previous state (a running timer on a closed or
  // pause-configured ticket) is the bug this repairs, so there is nothing
  // worth restoring. The sla_audit_log rows record what was changed.
};
