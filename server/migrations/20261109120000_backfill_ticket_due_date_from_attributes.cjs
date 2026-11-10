/**
 * Backfill tickets.due_date from attributes.due_date.
 *
 * `tickets.update_fields` used to store a workflow-set due date in attributes.due_date and never in the
 * column, so the UI, SLA, reports and the ticket.due_date date trigger could not see it. The action now
 * writes the column; this copies the old values over.
 *
 * - Only rows whose column is NULL are touched, so a due date set any other way is never overwritten.
 * - The attribute key stays in place so a workflow still reading attributes.due_date keeps working.
 * - Rows whose attribute does not parse as a timestamp are left alone and counted in the log.
 *
 * NOTE: tickets is distributed in Citus; this runs outside a transaction, in keyset batches of candidate
 * rows and one UPDATE per row, so a value Postgres rejects only fails its own UPDATE.
 */
exports.config = { transaction: false };

// Cheap shape filter so the cast is only attempted on values that look like ISO timestamps.
const ISO_SHAPE = '^[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\\.[0-9]+)?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)?)?$';

const BATCH_SIZE = 500;

async function backfillTicketDueDatesFromAttributes(knex, log = console.log, batchSize = BATCH_SIZE) {
  let copied = 0;
  let skipped = 0;
  // Keyset batches over (tenant, ticket_id): unparsable rows keep a NULL column, so paging by key (not by
  // "still NULL") is what moves past them.
  let afterTenant = null;
  let afterTicket = null;
  for (;;) {
    const candidates = await knex.raw(
      `SELECT tenant, ticket_id, attributes->>'due_date' AS raw_due_date
         FROM tickets
        WHERE due_date IS NULL
          AND attributes IS NOT NULL
          AND jsonb_typeof(attributes) = 'object'
          AND attributes->>'due_date' IS NOT NULL
          AND attributes->>'due_date' <> ''
          AND (?::uuid IS NULL OR (tenant, ticket_id) > (?::uuid, ?::uuid))
        ORDER BY tenant, ticket_id
        LIMIT ?`,
      [afterTenant, afterTenant, afterTicket, batchSize]
    );
    const rows = candidates.rows;
    for (const row of rows) {
      const shaped = await knex.raw('SELECT ?::text ~ ? AS ok', [row.raw_due_date, ISO_SHAPE]);
      if (!shaped.rows[0].ok) { skipped += 1; continue; }
      try {
        // A nested transaction is a savepoint inside a caller's transaction, so a failed cast cannot abort it.
        const result = await knex.transaction(async (sp) => sp.raw(
          'UPDATE tickets SET due_date = ?::timestamptz WHERE tenant = ? AND ticket_id = ? AND due_date IS NULL',
          [row.raw_due_date, row.tenant, row.ticket_id]
        ));
        copied += result.rowCount ?? 0;
      } catch (error) {
        skipped += 1; // e.g. 2026-13-45: right shape, not a real date
      }
    }
    if (rows.length < batchSize) break;
    afterTenant = rows[rows.length - 1].tenant;
    afterTicket = rows[rows.length - 1].ticket_id;
  }
  log(`[backfill ticket due_date] copied ${copied} from attributes.due_date, left ${skipped} unparsable`);
  return { copied, skipped };
}

exports.backfillTicketDueDatesFromAttributes = backfillTicketDueDatesFromAttributes;

exports.up = async function up(knex) {
  const hasDueDate = await knex.schema.hasColumn('tickets', 'due_date');
  if (!hasDueDate) return;
  await backfillTicketDueDatesFromAttributes(knex);
};

// Not reversible: the copied values are indistinguishable from due dates set any other way.
exports.down = async function down() {};
