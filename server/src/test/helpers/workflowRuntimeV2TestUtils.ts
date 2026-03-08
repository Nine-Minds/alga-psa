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

export async function ensureWorkflowScheduleStateTable(db: Knex): Promise<void> {
  const hasScheduleTable = await db.schema.hasTable('tenant_workflow_schedule');
  if (hasScheduleTable) return;
  await workflowScheduleMigration.up(db);
}

export async function resetWorkflowRuntimeTables(db: Knex): Promise<void> {
  const tables = [...WORKFLOW_TABLES];
  if (await db.schema.hasTable('tenant_workflow_schedule')) {
    tables.unshift('tenant_workflow_schedule');
  }
  await db.raw(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
