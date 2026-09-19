/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */

// Composite (tenant, X) FKs must never use bare ON DELETE SET NULL: Postgres
// would null the tenant column too (see 20260611150000_fix_tenant_nulling_
// foreign_keys.cjs). PG 15+ supports column-targeted SET NULL; Citus and
// older PG fall back to NO ACTION.
const addTenantSafeSetNullFk = async (knex, { table, constraint, columns, refTable, refColumns, settable }) => {
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
  await knex.schema.alterTable('invoices', (table) => {
    table.uuid('project_id').nullable();
    table.index(['tenant', 'project_id'], 'idx_invoices_tenant_project');
  });

  await addTenantSafeSetNullFk(knex, {
    table: 'invoices',
    constraint: 'invoices_project_fk',
    columns: 'tenant, project_id',
    refTable: 'projects',
    refColumns: 'tenant, project_id',
    settable: 'project_id',
  });
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE invoices DROP CONSTRAINT IF EXISTS "invoices_project_fk"');
  await knex.schema.alterTable('invoices', (table) => {
    table.dropIndex(['tenant', 'project_id'], 'idx_invoices_tenant_project');
    table.dropColumn('project_id');
  });
};
