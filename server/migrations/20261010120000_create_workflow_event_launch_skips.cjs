const { canCreateDistributedTable, isDistributed } = require('./utils/citusDistribution.cjs');

// Keep in sync with ee/packages/workflows/src/lib/workflowLaunchSkipReasons.ts
// (enforced by workflowLaunchSkipReasons.test.ts).
const REASONS = [
  'missing_schema_ref',
  'unknown_schema_ref',
  'missing_source_schema',
  'schema_mismatch',
  'payload_mapping_failed',
  'payload_validation_failed',
  'launch_failed',
  'paused',
  'lineage_loop_guard',
  'self_trigger_guard',
  'causation_depth_exceeded',
];

const TABLE = 'workflow_event_launch_skips';

exports.up = async function up(knex) {
  const reasonList = REASONS.map((r) => `'${r}'`).join(', ');
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      tenant uuid NOT NULL,
      skip_id uuid NOT NULL DEFAULT gen_random_uuid(),
      event_id uuid NOT NULL,
      workflow_id uuid NOT NULL,
      workflow_version integer NULL,
      event_name text NOT NULL,
      reason text NOT NULL,
      intentional boolean NOT NULL,
      message text NOT NULL,
      details jsonb NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ${TABLE}_pkey PRIMARY KEY (tenant, skip_id),
      CONSTRAINT ${TABLE}_event_workflow_unique UNIQUE (tenant, event_id, workflow_id),
      CONSTRAINT ${TABLE}_reason_check CHECK (reason IN (${reasonList}))
    )
  `);
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS idx_${TABLE}_workflow_created ON ${TABLE} (tenant, workflow_id, created_at DESC)`
  );
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS idx_${TABLE}_alarming_created ON ${TABLE} (tenant, created_at DESC) WHERE intentional = false`
  );

  // Citus: colocate with workflow_runtime_events (NOT `tenants`, which may be a
  // different colocation group than the v2 workflow tables). No-op on plain Postgres.
  if (!(await canCreateDistributedTable(knex))) return;
  if (await isDistributed(knex, TABLE)) return;
  if (!(await isDistributed(knex, 'workflow_runtime_events'))) return;
  await knex.raw(
    `SELECT create_distributed_table('${TABLE}', 'tenant', colocate_with => 'workflow_runtime_events')`
  );
};

exports.down = async function down(knex) {
  // DROP TABLE works for distributed tables as well (Citus propagates it).
  await knex.raw(`DROP TABLE IF EXISTS ${TABLE}`);
};
