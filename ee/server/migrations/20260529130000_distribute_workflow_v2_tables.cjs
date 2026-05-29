// Migration B (DISTRIBUTE) of the Workflow Runtime V2 Citus colocation work.
// Runs AFTER Deploy 1 (code writes `tenant` only). Distributes the v2 tables into
// colocation group 41 (the uuid group of the v1 workflow tables) on `tenant`.
//
// Per-table sequence: drop FKs/uniques/PK -> recreate PK as (tenant, <id>) ->
// create_distributed_table(..., 'tenant', colocate_with => 'workflow_tasks')
// -> truncate_local_data_after_distributing_table (Citus leaves the original rows
// as LOCAL coordinator data after distributing a non-empty table, and that
// leftover data blocks the FK/constraint re-adds) -> re-add tenant-scoped uniques
// and FKs. `tenant_id` columns remain (vestigial) until the cleanup migration C.
//
// MUST be validated on a Citus staging clone before production: the exact set of
// pre-existing constraints/indexes varies, and this migration drops/recreates
// them defensively. See .ai/workflow-v2-citus-colocation-plan.md.

exports.config = { transaction: false };

const UUID_REGEX =
  "'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'";

// Colocate the v2 tables with an existing distributed v1 workflow table in the
// uuid group 41. workflow_tasks is present and distributed on tenant in group 41.
const COLOCATE_WITH = 'workflow_tasks';

// Single natural-id PK column per table (tenant is prepended).
const PK_ID = {
  workflow_definitions: 'workflow_id',
  workflow_runs: 'run_id',
  workflow_definition_versions: 'version_id',
  workflow_run_steps: 'step_id',
  workflow_run_waits: 'wait_id',
  workflow_run_snapshots: 'snapshot_id',
  workflow_action_invocations: 'invocation_id',
  workflow_run_logs: 'log_id',
  workflow_runtime_events: 'event_id',
  tenant_workflow_schedule: 'id',
};

// Distribute parents before children so FK targets exist + are colocated first.
const DISTRIBUTE_ORDER = [
  'workflow_definitions',
  'workflow_runs',
  'workflow_definition_versions',
  'workflow_run_steps',
  'workflow_run_waits',
  'workflow_run_snapshots',
  'workflow_action_invocations',
  'workflow_run_logs',
  'workflow_runtime_events',
  'tenant_workflow_schedule',
];

const RUN_CHILDREN = [
  'workflow_run_steps',
  'workflow_run_waits',
  'workflow_run_snapshots',
  'workflow_action_invocations',
  'workflow_run_logs',
];

// Tenant-scoped uniques to re-add after distribution (tenant-prefixed).
const UNIQUES = [
  { table: 'workflow_definition_versions', name: 'workflow_definition_versions_tenant_workflow_version_unique', cols: ['tenant', 'workflow_id', 'version'] },
  { table: 'workflow_action_invocations', name: 'workflow_action_invocations_tenant_idempotency_unique', cols: ['tenant', 'action_id', 'action_version', 'idempotency_key'] },
  { table: 'tenant_workflow_schedule', name: 'tenant_workflow_schedule_tenant_workflow_unique', cols: ['tenant', 'workflow_id'] },
];

// Tenant-scoped FKs to re-add (all ON DELETE CASCADE, matching the originals).
const FKS = [
  { name: 'workflow_runs_tenant_workflow_fk', table: 'workflow_runs', cols: ['tenant', 'workflow_id'], ref: 'workflow_definitions', refCols: ['tenant', 'workflow_id'] },
  { name: 'workflow_definition_versions_tenant_workflow_fk', table: 'workflow_definition_versions', cols: ['tenant', 'workflow_id'], ref: 'workflow_definitions', refCols: ['tenant', 'workflow_id'] },
  { name: 'workflow_run_steps_tenant_run_fk', table: 'workflow_run_steps', cols: ['tenant', 'run_id'], ref: 'workflow_runs', refCols: ['tenant', 'run_id'] },
  { name: 'workflow_run_waits_tenant_run_fk', table: 'workflow_run_waits', cols: ['tenant', 'run_id'], ref: 'workflow_runs', refCols: ['tenant', 'run_id'] },
  { name: 'workflow_run_snapshots_tenant_run_fk', table: 'workflow_run_snapshots', cols: ['tenant', 'run_id'], ref: 'workflow_runs', refCols: ['tenant', 'run_id'] },
  { name: 'workflow_action_invocations_tenant_run_fk', table: 'workflow_action_invocations', cols: ['tenant', 'run_id'], ref: 'workflow_runs', refCols: ['tenant', 'run_id'] },
  { name: 'workflow_run_logs_tenant_run_fk', table: 'workflow_run_logs', cols: ['tenant', 'run_id'], ref: 'workflow_runs', refCols: ['tenant', 'run_id'] },
];

const isCitusEnabled = async (knex) => {
  const r = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled");
  return Boolean(r.rows?.[0]?.enabled);
};

const ensureSequentialMode = async (knex) => {
  await knex.raw("SET citus.multi_shard_modify_mode TO 'sequential'");
};

const isDistributed = async (knex, table) => {
  const r = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass) AS d`,
    [table]
  );
  return Boolean(r.rows?.[0]?.d);
};

const dropForeignKeys = async (knex, table) => {
  const r = await knex.raw(
    `SELECT conname FROM pg_constraint WHERE conrelid = ?::regclass AND contype = 'f'`,
    [table]
  );
  for (const row of r.rows) {
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ?? CASCADE', [table, row.conname]);
  }
};

const dropUniqueConstraints = async (knex, table) => {
  const r = await knex.raw(
    `SELECT conname FROM pg_constraint WHERE conrelid = ?::regclass AND contype = 'u'`,
    [table]
  );
  for (const row of r.rows) {
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ?? CASCADE', [table, row.conname]);
  }
};

// Drop UNIQUE indexes that are not backed by a constraint (e.g. partial unique
// indexes). Non-unique indexes are left alone — Citus only requires the
// distribution column in UNIQUE/PK/exclusion constraints.
const dropUniqueIndexes = async (knex, table) => {
  const r = await knex.raw(
    `SELECT i.relname AS idxname
       FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_class t ON t.oid = x.indrelid
      WHERE t.relname = ? AND x.indisunique AND NOT x.indisprimary
        AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid)`,
    [table]
  );
  for (const row of r.rows) {
    await knex.raw('DROP INDEX IF EXISTS ??', [row.idxname]);
  }
};

// Drop non-internal triggers — Citus rejects create_distributed_table on a table
// with triggers unless citus.enable_unsafe_triggers is set. The v2 tables have
// none (updated_at is set in app code), so this is a defensive no-op.
const dropTriggers = async (knex, table) => {
  const r = await knex.raw(
    `SELECT tgname FROM pg_trigger WHERE tgrelid = ?::regclass AND NOT tgisinternal`,
    [table]
  );
  for (const row of r.rows) {
    await knex.raw('DROP TRIGGER IF EXISTS ?? ON ??', [row.tgname, table]);
  }
};

const getPrimaryKey = async (knex, table) => {
  const r = await knex.raw(
    `SELECT c.conname AS constraint_name
       FROM pg_constraint c
      WHERE c.conrelid = ?::regclass AND c.contype = 'p'`,
    [table]
  );
  return r.rows?.[0]?.constraint_name ?? null;
};

const recreateTenantPrimaryKey = async (knex, table) => {
  const existing = await getPrimaryKey(knex, table);
  if (existing) {
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ?? CASCADE', [table, existing]);
  }
  await knex.raw('ALTER TABLE ?? ADD PRIMARY KEY (tenant, ??)', [table, PK_ID[table]]);
};

exports.up = async function up(knex) {
  if (!(await isCitusEnabled(knex))) {
    console.log('Citus not enabled, skipping workflow v2 distribution');
    return;
  }
  await ensureSequentialMode(knex);

  const present = [];
  for (const table of DISTRIBUTE_ORDER) {
    if (await knex.schema.hasTable(table)) present.push(table);
  }

  // 1. Final backfill of any NULL tenant (rollover rows written by old code), then
  //    enforce NOT NULL (required: the distribution column must be NOT NULL).
  for (const table of present) {
    if (await knex.schema.hasColumn(table, 'tenant_id')) {
      await knex.raw(
        `UPDATE ?? SET tenant = tenant_id::uuid WHERE tenant IS NULL AND tenant_id ~ ${UUID_REGEX}`,
        [table]
      );
    }
  }
  for (const table of RUN_CHILDREN) {
    if (!present.includes(table)) continue;
    await knex.raw(
      `UPDATE ?? AS c SET tenant = r.tenant
         FROM workflow_runs r
        WHERE c.run_id = r.run_id AND c.tenant IS NULL AND r.tenant IS NOT NULL`,
      [table]
    );
  }
  if (present.includes('workflow_definition_versions')) {
    await knex.raw(
      `UPDATE workflow_definition_versions AS v SET tenant = d.tenant
         FROM workflow_definitions d
        WHERE v.workflow_id = d.workflow_id AND v.tenant IS NULL AND d.tenant IS NOT NULL`
    );
  }
  for (const table of present) {
    const nulls = await knex(table).whereNull('tenant').count({ c: '*' }).first();
    if (Number(nulls?.c ?? 0) > 0) {
      throw new Error(`Cannot distribute ${table}: ${nulls.c} rows still have NULL tenant`);
    }
    await knex.raw('ALTER TABLE ?? ALTER COLUMN tenant SET NOT NULL', [table]);
  }

  // 2. Drop all FKs across the v2 set first (so PKs they reference can be rebuilt).
  for (const table of present) {
    await dropForeignKeys(knex, table);
  }

  // 3. Per table: drop triggers + uniques + unique indexes, recreate PK as (tenant, <id>).
  for (const table of present) {
    await dropTriggers(knex, table);
    await dropUniqueConstraints(knex, table);
    await dropUniqueIndexes(knex, table);
    await recreateTenantPrimaryKey(knex, table);
  }

  // 4. Distribute (parents first), then immediately truncate the leftover LOCAL
  //    coordinator data — it otherwise blocks the constraint re-adds below.
  //    Cast to ::regclass explicitly so the Citus functions resolve unambiguously.
  console.log(`Colocating workflow v2 tables with ${COLOCATE_WITH}`);
  for (const table of present) {
    if (!(await isDistributed(knex, table))) {
      await knex.raw(`SELECT create_distributed_table(?::regclass, 'tenant', colocate_with => ?)`, [table, COLOCATE_WITH]);
    }
    await knex.raw('SELECT truncate_local_data_after_distributing_table(?::regclass)', [table]);
  }

  // 5. Re-add tenant-scoped uniques and FKs (targets are now distributed+colocated).
  //    DROP IF EXISTS first so a re-run after a partial failure is idempotent.
  for (const u of UNIQUES) {
    if (!present.includes(u.table)) continue;
    const cols = u.cols.map(() => '??').join(', ');
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??', [u.table, u.name]);
    await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT ?? UNIQUE (${cols})`, [u.table, u.name, ...u.cols]);
  }
  // Restore workflow_definitions' per-tenant unique key (partial → unique index;
  // dropped above because the old one was on tenant_id, not the dist column).
  if (present.includes('workflow_definitions')) {
    await knex.raw('DROP INDEX IF EXISTS workflow_definitions_tenant_key_unique');
    await knex.raw(
      'CREATE UNIQUE INDEX workflow_definitions_tenant_key_unique ON workflow_definitions (tenant, key) WHERE key IS NOT NULL'
    );
  }
  for (const fk of FKS) {
    if (!present.includes(fk.table) || !present.includes(fk.ref)) continue;
    const cols = fk.cols.map(() => '??').join(', ');
    const refCols = fk.refCols.map(() => '??').join(', ');
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??', [fk.table, fk.name]);
    await knex.raw(
      `ALTER TABLE ?? ADD CONSTRAINT ?? FOREIGN KEY (${cols}) REFERENCES ?? (${refCols}) ON DELETE CASCADE`,
      [fk.table, fk.name, ...fk.cols, fk.ref, ...fk.refCols]
    );
  }

  // 6. Verify: every targeted table is distributed on tenant and shares one
  //    colocationid. (Fetch all rows and filter in JS — array bindings in raw
  //    SQL are unreliable in knex.)
  const check = await knex.raw(
    `SELECT logicalrelid::text AS tbl,
            column_to_column_name(logicalrelid, partkey) AS dist_col,
            colocationid
       FROM pg_dist_partition`
  );
  const rows = (check.rows || []).filter((r) => present.includes(r.tbl));
  const badCol = rows.filter((r) => r.dist_col !== 'tenant');
  if (badCol.length) {
    throw new Error(`Tables not distributed on tenant: ${badCol.map((r) => r.tbl).join(', ')}`);
  }
  const missing = present.filter((t) => !rows.some((r) => r.tbl === t));
  if (missing.length) {
    throw new Error(`Tables not distributed at all: ${missing.join(', ')}`);
  }
  const groups = new Set(rows.map((r) => r.colocationid));
  if (groups.size !== 1) {
    throw new Error(`Workflow v2 tables landed in multiple colocation groups: ${[...groups].join(', ')}`);
  }
  console.log(`Workflow v2 tables distributed into colocation group ${[...groups][0]}`);
};

exports.down = async function down() {
  // Deliberately no-op: create_distributed_table cannot be safely reversed once
  // writes resume. Roll forward instead.
};
