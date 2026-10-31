const { ensureTenantDistribution, ensureCompositeFk } = require('./utils/citusDistribution.cjs');

// CM L6a2 (1 of 5): one provenance row per MSP time entry booked against shared customer work.
// Keyed on the ENTRY (unique (tenant, entry_id)) so the effort query counts every entry exactly
// once however many relations can see the shared ticket. It carries the qualified source the
// entry was booked against; there is deliberately no FK to the customer's work rows, so the
// MSP's billing evidence survives the customer's departure. No triggers (Citus skips them;
// invariants live in app code). Expand-only: nothing existing reads this table.
const TABLE = 'co_managed_work_references';

exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('time_entries'))) return;
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('reference_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('entry_id').notNullable();
      table.uuid('customer_tenant').notNullable();
      table.uuid('relationship_id').notNullable();
      table.string('source_kind', 20).notNullable();
      table.uuid('source_id').notNullable();
      // MSP-local routing row (co_managed_ticket_references / co_managed_project_task_references)
      // that time_entries.work_item_id points at.
      table.uuid('local_reference_id').notNullable();
      table.uuid('client_id').notNullable();
      table.string('ticket_number', 100).nullable();
      table.text('title').nullable();
      table.timestamp('captured_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'reference_id']);
      table.unique(['tenant', 'entry_id'], { indexName: 'co_work_reference_entry_unique' });
      table.check("tenant <> customer_tenant AND source_kind IN ('ticket', 'project_task')", [], 'co_work_reference_shape_check');
    });
  }
  await ensureTenantDistribution(knex, TABLE);
  await ensureCompositeFk(knex, { table: TABLE, constraint: 'co_work_reference_entry_fk', columns: ['tenant', 'entry_id'],
    referencedTable: 'time_entries', referencedColumns: ['tenant', 'entry_id'], onDelete: 'RESTRICT' });
  await ensureCompositeFk(knex, { table: TABLE, constraint: 'co_work_reference_client_fk', columns: ['tenant', 'client_id'],
    referencedTable: 'clients', referencedColumns: ['tenant', 'client_id'], onDelete: 'RESTRICT' });
  // New table: a plain (non-concurrent) index is safe, nothing reads or writes it yet.
  await knex.raw(`CREATE INDEX IF NOT EXISTS co_work_reference_source_idx
    ON ${TABLE} (tenant, customer_tenant, relationship_id, source_kind, source_id)`);
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  if (await knex(TABLE).first()) throw new Error('Cannot discard retained co-managed work references');
  await knex.schema.dropTable(TABLE);
};
