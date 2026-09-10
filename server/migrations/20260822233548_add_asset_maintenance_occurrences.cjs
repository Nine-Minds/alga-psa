
/** Operational maintenance occurrences. Composite tenant keys are required for Citus colocation. */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

exports.up = async function up(knex) {
  await knex.schema.alterTable('asset_maintenance_schedules', (table) => {
    table.timestamp('archived_at', { useTz: true }).nullable();
  });

  await knex.schema.createTable('asset_maintenance_occurrences', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('occurrence_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('schedule_id').notNullable();
    table.uuid('asset_id').notNullable();
    table.timestamp('due_date', { useTz: true }).notNullable();
    table.text('status').notNullable().defaultTo('open');
    table.uuid('ticket_id').nullable();
    table.uuid('history_id').nullable();
    table.text('skip_reason').nullable();
    table.timestamp('closed_at', { useTz: true }).nullable();
    table.uuid('closed_by').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'occurrence_id']);
    table.foreign(['tenant', 'schedule_id'], 'asset_maintenance_occurrences_schedule_fk').references(['tenant', 'schedule_id']).inTable('asset_maintenance_schedules').onDelete('CASCADE');
    table.foreign(['tenant', 'asset_id'], 'asset_maintenance_occurrences_asset_fk').references(['tenant', 'asset_id']).inTable('assets').onDelete('CASCADE');
    // asset_maintenance_history predates the Citus composite-key convention and
    // has a legacy single-column PK, so a tenant-composite FK is impossible.
    // The completion transaction writes/stamps this id atomically instead.
    table.foreign(['tenant', 'closed_by'], 'asset_maintenance_occurrences_closed_by_fk').references(['tenant', 'user_id']).inTable('users');
    table.index(['tenant', 'due_date'], 'asset_maintenance_occurrences_tenant_due_date_idx');
    table.index(['tenant', 'status'], 'asset_maintenance_occurrences_tenant_status_idx');
    table.index(['tenant', 'schedule_id'], 'asset_maintenance_occurrences_tenant_schedule_idx');
  });
  await knex.raw("ALTER TABLE asset_maintenance_occurrences ADD CONSTRAINT asset_maintenance_occurrences_status_check CHECK (status IN ('open', 'completed', 'skipped', 'cancelled')) NOT VALID");
  await knex.raw('ALTER TABLE asset_maintenance_occurrences VALIDATE CONSTRAINT asset_maintenance_occurrences_status_check');
  // The idempotency and double-completion boundary: exactly one open occurrence per plan.
  await knex.raw("CREATE UNIQUE INDEX asset_maintenance_occurrences_one_open_per_schedule ON asset_maintenance_occurrences (tenant, schedule_id) WHERE status = 'open'");
  // Citus requires a distributed table's FK targets to be distributed/reference
  // tables first. asset_maintenance_schedules was created (20241112) long before
  // the Citus distribution convention and is still a plain local table, so the
  // occurrences -> schedules FK breaks create_distributed_table. Distribute the
  // schedules parent (colocated with tenants, alongside its already-distributed
  // assets/users FK targets) before distributing occurrences. Idempotent: the
  // util no-ops when the table is already distributed or on plain Postgres.
  await ensureTenantDistribution(knex, 'asset_maintenance_schedules');
  await ensureTenantDistribution(knex, 'asset_maintenance_occurrences');
  // Citus rejects multiple utility statements in a single command against a
  // distributed table ("cannot execute multiple utility events"), so enable RLS
  // and create the policy as separate raw calls.
  await knex.raw("ALTER TABLE asset_maintenance_occurrences ENABLE ROW LEVEL SECURITY");
  await knex.raw("CREATE POLICY tenant_isolation_policy ON asset_maintenance_occurrences USING (tenant::TEXT = current_setting('app.current_tenant')::TEXT)");
  await knex.raw("INSERT INTO asset_maintenance_occurrences (tenant, schedule_id, asset_id, due_date, status) SELECT tenant, schedule_id, asset_id, next_maintenance, 'open' FROM asset_maintenance_schedules WHERE is_active = true AND archived_at IS NULL ON CONFLICT (tenant, schedule_id) WHERE status = 'open' DO NOTHING");
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('asset_maintenance_occurrences');
  await knex.schema.alterTable('asset_maintenance_schedules', (table) => table.dropColumn('archived_at'));
};

exports.config = { transaction: false };
