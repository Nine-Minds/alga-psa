/**
 * Immutable per-entry work-item snapshot for ticket-level invoice detail.
 *
 * `invoice_time_entries` links each generated time charge to its source time
 * entry. This adds a nullable jsonb snapshot (InvoiceTimeEntrySnapshot in
 * packages/types) frozen at invoice generation: work-item type/id, ticket
 * number, title, customer-visible description, billed date, billed minutes,
 * hourly rate and net amount in minor units, and the service. Invoice Layouts
 * render ticket-level billed-time detail from this column only, so a
 * finalized invoice can never change when the source ticket or time entry is
 * edited later.
 *
 * NULL (every pre-existing row) means "no snapshot": legacy invoices render
 * without ticket-level detail. There is deliberately no backfill — deriving
 * snapshots from today's mutable ticket data would fabricate history.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('invoice_time_entries', 'work_item_snapshot');
  if (!hasColumn) {
    await knex.schema.alterTable('invoice_time_entries', function (table) {
      table.jsonb('work_item_snapshot').nullable();
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  const hasColumn = await knex.schema.hasColumn('invoice_time_entries', 'work_item_snapshot');
  if (hasColumn) {
    await knex.schema.alterTable('invoice_time_entries', function (table) {
      table.dropColumn('work_item_snapshot');
    });
  }
};
