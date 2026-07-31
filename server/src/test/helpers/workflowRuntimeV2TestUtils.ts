import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Knex } from 'knex';

const WORKFLOW_TABLES = [
  'workflow_runtime_events',
  'workflow_run_snapshots',
  'workflow_action_invocations',
  'workflow_run_waits',
  'workflow_run_steps',
  'workflow_runs',
  'workflow_definition_versions',
  'workflow_definitions',
  'workflow_task_history',
  'workflow_tasks'
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const workflowScheduleMigration = require(
  path.resolve(__dirname, '../../../../ee/server/migrations/20260307200000_create_workflow_schedule_tables.cjs')
) as { up: (knex: Knex) => Promise<void> };
const workflowScheduleExpansionMigration = require(
  path.resolve(__dirname, '../../../../ee/server/migrations/20260308130000_expand_workflow_schedule_for_external_schedules.cjs')
) as { up: (knex: Knex) => Promise<void> };
const workflowScheduleBusinessDayMigration = require(
  path.resolve(__dirname, '../../../../ee/server/migrations/20260410120000_add_workflow_schedule_business_day_fields.cjs')
) as { up: (knex: Knex) => Promise<void> };

export async function ensureWorkflowScheduleStateTable(db: Knex): Promise<void> {
  const hasScheduleTable = await db.schema.hasTable('tenant_workflow_schedule');
  if (!hasScheduleTable) {
    await workflowScheduleMigration.up(db);
  }

  const hasNameColumn = await db.schema.hasColumn('tenant_workflow_schedule', 'name');
  const hasPayloadColumn = await db.schema.hasColumn('tenant_workflow_schedule', 'payload_json');
  if (!hasNameColumn || !hasPayloadColumn) {
    await workflowScheduleExpansionMigration.up(db);
  }

  const hasDayTypeFilterColumn = await db.schema.hasColumn('tenant_workflow_schedule', 'day_type_filter');
  const hasBusinessHoursScheduleIdColumn = await db.schema.hasColumn('tenant_workflow_schedule', 'business_hours_schedule_id');
  if (!hasDayTypeFilterColumn || !hasBusinessHoursScheduleIdColumn) {
    await workflowScheduleBusinessDayMigration.up(db);
  }

  // The EE create migrations above predate the workflow-v2 tenant_id→tenant
  // colocation rename (CE migrations 20260529*). A helper-created table would
  // otherwise miss the `tenant` column the runtime now reads and writes.
  const hasTenantColumn = await db.schema.hasColumn('tenant_workflow_schedule', 'tenant');
  if (!hasTenantColumn) {
    await db.schema.alterTable('tenant_workflow_schedule', (t) => {
      t.uuid('tenant');
    });
    await db.raw(
      `UPDATE tenant_workflow_schedule SET tenant = tenant_id::uuid
        WHERE tenant IS NULL
          AND tenant_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'`
    );
  }
  if (await db.schema.hasColumn('tenant_workflow_schedule', 'tenant_id')) {
    await db.schema.alterTable('tenant_workflow_schedule', (t) => {
      t.dropColumn('tenant_id');
    });
  }
}

export async function resetWorkflowRuntimeTables(db: Knex): Promise<void> {
  const tables = [...WORKFLOW_TABLES];
  if (await db.schema.hasTable('tenant_workflow_schedule')) {
    tables.unshift('tenant_workflow_schedule');
  }
  await db.raw(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
