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
}

export async function resetWorkflowRuntimeTables(db: Knex): Promise<void> {
  const tables = [...WORKFLOW_TABLES];
  if (await db.schema.hasTable('tenant_workflow_schedule')) {
    tables.unshift('tenant_workflow_schedule');
  }
  await db.raw(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
