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

export async function resetWorkflowRuntimeTables(db: Knex): Promise<void> {
  await db.raw(`TRUNCATE ${WORKFLOW_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}
