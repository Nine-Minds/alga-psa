// Migration A (EXPAND) of the Workflow Runtime V2 Citus colocation work.
// Adds a nullable `tenant uuid` column to every v2 table and backfills it, so the
// next deploy can switch the code to `tenant`-only (no legacy `tenant_id`) and
// Migration B can distribute these tables into colocation group 41 (uuid).
//
// Two v2 tables (workflow_definitions, tenant_workflow_schedule) are currently
// distributed on `tenant_id` (text). Once the code stops writing `tenant_id`,
// Citus cannot route their inserts (no distribution-column value) and `tenant_id`
// is NOT NULL. So this migration also undistributes those two (back to local for
// the duration of the transition) and drops their `tenant_id NOT NULL`. Migration
// B redistributes everything on `tenant`. No triggers.
// See .ai/workflow-v2-citus-colocation-plan.md.

exports.config = { transaction: false };

const UUID_REGEX =
  "'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'";

// Parents already carry a textual tenant identifier (tenant_id).
const PARENT_TABLES = [
  'workflow_definitions',
  'workflow_runs',
  'workflow_run_logs',
  'workflow_runtime_events',
  'tenant_workflow_schedule',
];

// Children carried no tenant column; they get `tenant` backfilled from a parent.
const RUN_CHILDREN = [
  'workflow_run_steps',
  'workflow_run_waits',
  'workflow_run_snapshots',
  'workflow_action_invocations',
];
const DEF_CHILDREN = ['workflow_definition_versions'];

const ALL_TABLES = [...PARENT_TABLES, ...RUN_CHILDREN, ...DEF_CHILDREN];

// Distributed-on-text tables that must go local for the tenant-only code window.
const DISTRIBUTED_PARENTS = ['workflow_definitions', 'tenant_workflow_schedule'];

const isCitusEnabled = async (knex) => {
  const result = await knex.raw(
    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled"
  );
  return Boolean(result.rows?.[0]?.enabled);
};

const ensureSequentialMode = async (knex) => {
  if (await isCitusEnabled(knex)) {
    await knex.raw("SET citus.multi_shard_modify_mode TO 'sequential'");
  }
};

const addTenantColumn = async (knex, table) => {
  if (!(await knex.schema.hasTable(table))) return;
  if (await knex.schema.hasColumn(table, 'tenant')) return;
  await knex.schema.alterTable(table, (t) => {
    t.uuid('tenant');
  });
};

const isDistributed = async (knex, table) => {
  const result = await knex.raw(
    `SELECT EXISTS (
       SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass
     ) AS distributed`,
    [table]
  );
  return Boolean(result.rows?.[0]?.distributed);
};

// Normalize a value that may be a JS array or a Postgres array literal string
// (`{a,b}`) — `array_agg(name)` returns name[], which node-postgres leaves as a
// raw string rather than parsing into a JS array.
const toArray = (val) => {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    return val
      .replace(/^\{|\}$/g, '')
      .split(',')
      .map((s) => s.replace(/^"|"$/g, '').trim())
      .filter(Boolean);
  }
  return [];
};

const getPrimaryKey = async (knex, table) => {
  const result = await knex.raw(
    `SELECT c.conname AS constraint_name,
            array_agg(a.attname::text ORDER BY ord.ordinality) AS columns
       FROM pg_constraint c
       JOIN unnest(c.conkey) WITH ORDINALITY AS ord(attnum, ordinality) ON true
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ord.attnum
      WHERE c.conrelid = ?::regclass AND c.contype = 'p'
      GROUP BY c.conname`,
    [table]
  );
  const row = result.rows?.[0];
  if (!row) return null;
  return { constraint_name: row.constraint_name, columns: toArray(row.columns) };
};

// PK columns are implicitly NOT NULL, so tenant_id must leave the PK before
// tenant-only code (which omits tenant_id) can insert. Rebuild the PK on the
// remaining natural-key columns. Migration B re-adds tenant to the PK.
const dropTenantIdFromPrimaryKey = async (knex, table) => {
  const pk = await getPrimaryKey(knex, table);
  if (!pk || !pk.columns.includes('tenant_id')) return;
  const reduced = pk.columns.filter((c) => c !== 'tenant_id');
  if (!reduced.length) return;
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', [table, pk.constraint_name]);
  const placeholders = reduced.map(() => '??').join(', ');
  await knex.raw(`ALTER TABLE ?? ADD PRIMARY KEY (${placeholders})`, [table, ...reduced]);
};

exports.up = async function up(knex) {
  await ensureSequentialMode(knex);

  for (const table of ALL_TABLES) {
    await addTenantColumn(knex, table);
  }

  // Undistribute the two text-distributed parents so they are local for the
  // tenant-only code window (Citus cannot route their inserts once code stops
  // writing the tenant_id distribution column). Migration B redistributes them
  // on `tenant`.
  if (await isCitusEnabled(knex)) {
    for (const table of DISTRIBUTED_PARENTS) {
      if (!(await knex.schema.hasTable(table))) continue;
      if (await isDistributed(knex, table)) {
        await knex.raw('SELECT undistribute_table(?)', [table]);
      }
    }
  }

  // Remove tenant_id from the PK (PK columns are implicitly NOT NULL) and drop
  // its NOT NULL, so tenant-only code that omits tenant_id can insert. tenant_id
  // is dropped entirely in the cleanup migration.
  for (const table of DISTRIBUTED_PARENTS) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, 'tenant_id'))) continue;
    await dropTenantIdFromPrimaryKey(knex, table);
    await knex.raw('ALTER TABLE ?? ALTER COLUMN tenant_id DROP NOT NULL', [table]);
  }

  // Backfill parents from their own tenant_id (cast guarded so a stray non-uuid
  // value can never abort the migration — it just stays NULL for Migration B).
  for (const table of PARENT_TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    await knex.raw(
      `UPDATE ?? SET tenant = tenant_id::uuid
         WHERE tenant IS NULL AND tenant_id ~ ${UUID_REGEX}`,
      [table]
    );
  }

  // Backfill run-scoped children from workflow_runs (both local).
  for (const table of RUN_CHILDREN) {
    if (!(await knex.schema.hasTable(table))) continue;
    await knex.raw(
      `UPDATE ?? AS c
          SET tenant = r.tenant_id::uuid
         FROM workflow_runs r
        WHERE c.run_id = r.run_id
          AND c.tenant IS NULL
          AND r.tenant_id ~ ${UUID_REGEX}`,
      [table]
    );
  }

  // Backfill definition versions from workflow_definitions (now local).
  if (await knex.schema.hasTable('workflow_definition_versions')) {
    await knex.raw(
      `UPDATE workflow_definition_versions AS v
          SET tenant = d.tenant_id::uuid
         FROM workflow_definitions d
        WHERE v.workflow_id = d.workflow_id
          AND v.tenant IS NULL
          AND d.tenant_id ~ ${UUID_REGEX}`
    );
  }
};

exports.down = async function down(knex) {
  await ensureSequentialMode(knex);
  for (const table of ALL_TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, 'tenant'))) continue;
    await knex.schema.alterTable(table, (t) => {
      t.dropColumn('tenant');
    });
  }
};
