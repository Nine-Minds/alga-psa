/**
 * Associates a manual invoice with the support ticket it was raised from.
 *
 * The quick-invoice-a-ticket flow creates a manual invoice from selected
 * unbilled ticket items (time and products). The relationship is optional:
 * every other invoice keeps a null ticket_id, and the column is deliberately
 * not part of the invoice number/status pipeline.
 *
 * Mirrors 20260715090005_add_project_id_to_invoices.cjs so the tenant-safe
 * composite foreign key treatment is identical.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */

// Composite (tenant, X) FKs must never use bare ON DELETE SET NULL: Postgres
// would null the tenant column too (see 20260611150000_fix_tenant_nulling_
// foreign_keys.cjs). PG 15+ supports column-targeted SET NULL; Citus and
// older PG fall back to NO ACTION.
const addTenantSafeSetNullFk = async (knex, { table, constraint, columns, refTable, refColumns, settable }) => {
  const { rows: existing } = await knex.raw(
    "SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass LIMIT 1",
    [constraint, table],
  );
  if (existing.length > 0) {
    return;
  }
  const versionRow = await knex.raw("SELECT current_setting('server_version_num')::int AS v");
  const { rows: citusRows } = await knex.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus' LIMIT 1");
  const clause = versionRow.rows[0].v >= 150000 && citusRows.length === 0
    ? ` ON DELETE SET NULL (${settable})`
    : '';
  await knex.raw(`
    ALTER TABLE ${table}
    ADD CONSTRAINT "${constraint}"
    FOREIGN KEY (${columns})
    REFERENCES ${refTable} (${refColumns})${clause}
  `);
};

exports.up = async function up(knex) {
  const hasColumn = await knex.schema.hasColumn('invoices', 'ticket_id');
  if (!hasColumn) {
    await knex.schema.alterTable('invoices', (table) => {
      table.uuid('ticket_id').nullable();
      table.index(['tenant', 'ticket_id'], 'idx_invoices_tenant_ticket');
    });
  }

  await addTenantSafeSetNullFk(knex, {
    table: 'invoices',
    constraint: 'invoices_ticket_fk',
    columns: 'tenant, ticket_id',
    refTable: 'tickets',
    refColumns: 'tenant, ticket_id',
    settable: 'ticket_id',
  });
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE invoices DROP CONSTRAINT IF EXISTS "invoices_ticket_fk"');
  const hasColumn = await knex.schema.hasColumn('invoices', 'ticket_id');
  if (hasColumn) {
    await knex.schema.alterTable('invoices', (table) => {
      table.dropIndex(['tenant', 'ticket_id'], 'idx_invoices_tenant_ticket');
      table.dropColumn('ticket_id');
    });
  }
};
