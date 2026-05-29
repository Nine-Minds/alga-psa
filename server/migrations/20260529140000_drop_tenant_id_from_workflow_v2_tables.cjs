// Migration C (CONTRACT / cleanup) of the Workflow Runtime V2 Citus colocation
// work. Runs AFTER Migration B is distributed and verified in production and the
// deployed code no longer references `tenant_id`. Drops the now-vestigial legacy
// `tenant_id` columns from the parent tables (children never had one).
//
// RELEASE ORDERING: this must NOT be applied in the same migrate pass as
// Migration A/B. The chain is three sequential releases:
//   Release 1: Migration A + tenant-only code (Deploy 1)
//   Release 2: Migration B (distribute) + verify
//   Release 3: Migration C (this file)
// Applying A->B->C back-to-back against still-running old code would break it.
// See .ai/workflow-v2-citus-colocation-plan.md.

exports.config = { transaction: false };

const PARENTS_WITH_TENANT_ID = [
  'workflow_definitions',
  'workflow_runs',
  'workflow_run_logs',
  'workflow_runtime_events',
  'tenant_workflow_schedule',
];

const isCitusEnabled = async (knex) => {
  const r = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled");
  return Boolean(r.rows?.[0]?.enabled);
};

exports.up = async function up(knex) {
  if (await isCitusEnabled(knex)) {
    await knex.raw("SET citus.multi_shard_modify_mode TO 'sequential'");
  }
  for (const table of PARENTS_WITH_TENANT_ID) {
    if (!(await knex.schema.hasTable(table))) continue;
    if (!(await knex.schema.hasColumn(table, 'tenant_id'))) continue;

    // Recreate non-unique tenant_id indexes on `tenant` (same names) BEFORE
    // dropping the column, so CASCADE doesn't silently remove tenant-scoped query
    // coverage (e.g. idx_*_tenant_status, idx_*_tenant_created). Unique/PK indexes
    // were already rebuilt on `tenant` by Migration B, so they're excluded here.
    const indexes = await knex.raw(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = ?
          AND indexdef ILIKE '%tenant_id%' AND indexdef NOT ILIKE '%UNIQUE%'`,
      [table]
    );
    for (const row of indexes.rows) {
      const tenantDef = row.indexdef
        .replace(/tenant_id/g, 'tenant')
        .replace(/^CREATE INDEX /, 'CREATE INDEX IF NOT EXISTS ');
      await knex.raw('DROP INDEX IF EXISTS ??', [row.indexname]);
      await knex.raw(tenantDef);
    }

    await knex.raw('ALTER TABLE ?? DROP COLUMN tenant_id CASCADE', [table]);
  }
};

exports.down = async function down() {
  // Deliberately no-op: the legacy column is gone and is not restored.
};
