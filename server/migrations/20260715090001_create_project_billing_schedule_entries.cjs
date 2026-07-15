/**
 * Create milestone and deposit schedule entries for project billing.
 *
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
  await knex.schema.createTable('project_billing_schedule_entries', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('schedule_entry_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('config_id').notNullable();
    table.text('entry_type').notNullable();
    table.text('description').notNullable();
    table.bigInteger('amount').nullable();
    table.decimal('percentage', 7, 4).nullable();
    table.text('trigger_type').notNullable();
    table.uuid('phase_id').nullable();
    table.date('trigger_date').nullable();
    table.text('status').notNullable().defaultTo('pending');
    table.timestamp('ready_at', { useTz: true }).nullable();
    table.uuid('approved_by').nullable();
    table.timestamp('approved_at', { useTz: true }).nullable();
    table.uuid('invoice_id').nullable();
    table.uuid('invoice_charge_id').nullable();
    table.integer('display_order').notNullable().defaultTo(0);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.primary(['tenant', 'schedule_entry_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'config_id'], 'project_billing_schedule_entries_config_fk')
      .references(['tenant', 'config_id'])
      .inTable('project_billing_configs')
      .onDelete('CASCADE');
    table.index(['tenant', 'status'], 'idx_project_billing_schedule_entries_tenant_status');
    table.index(['tenant', 'phase_id'], 'idx_project_billing_schedule_entries_tenant_phase');
  });

  await addTenantSafeSetNullFk(knex, {
    table: 'project_billing_schedule_entries',
    constraint: 'project_billing_schedule_entries_phase_fk',
    columns: 'tenant, phase_id',
    refTable: 'project_phases',
    refColumns: 'tenant, phase_id',
    settable: 'phase_id',
  });
  await addTenantSafeSetNullFk(knex, {
    table: 'project_billing_schedule_entries',
    constraint: 'project_billing_schedule_entries_approved_by_fk',
    columns: 'tenant, approved_by',
    refTable: 'users',
    refColumns: 'tenant, user_id',
    settable: 'approved_by',
  });
  await addTenantSafeSetNullFk(knex, {
    table: 'project_billing_schedule_entries',
    constraint: 'project_billing_schedule_entries_invoice_fk',
    columns: 'tenant, invoice_id',
    refTable: 'invoices',
    refColumns: 'tenant, invoice_id',
    settable: 'invoice_id',
  });

  await knex.raw(`
    ALTER TABLE project_billing_schedule_entries
    ADD CONSTRAINT project_billing_schedule_entries_entry_type_check
    CHECK (entry_type IN ('milestone', 'deposit'))
  `);
  await knex.raw(`
    ALTER TABLE project_billing_schedule_entries
    ADD CONSTRAINT project_billing_schedule_entries_amount_percentage_check
    CHECK (
      (amount IS NOT NULL AND percentage IS NULL)
      OR (amount IS NULL AND percentage IS NOT NULL)
    )
  `);
  await knex.raw(`
    ALTER TABLE project_billing_schedule_entries
    ADD CONSTRAINT project_billing_schedule_entries_trigger_type_check
    CHECK (trigger_type IN ('phase', 'date', 'manual'))
  `);
  await knex.raw(`
    ALTER TABLE project_billing_schedule_entries
    ADD CONSTRAINT project_billing_schedule_entries_status_check
    CHECK (status IN ('pending', 'ready', 'approved', 'invoiced', 'canceled'))
  `);
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('project_billing_schedule_entries');
};
