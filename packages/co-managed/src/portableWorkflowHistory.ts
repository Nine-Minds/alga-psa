import type { prepareCoManagedPortableWorkspaceRecords } from './portableWorkspaceRestoreRecords';

type Prepared = ReturnType<typeof prepareCoManagedPortableWorkspaceRecords>;

/** Imported task responses are historical business records, never executable
 * task-inbox rows. Existing audit storage makes them available for review while
 * keeping every source execution, event and claim outside the destination. */
export function preparePortableWorkflowAuditHistory(prepared: Prepared) {
  const domain = (table: string, column: string) => prepared.domains.find(row => row.table === table && row.column === column)?.mappings ?? [];
  const users = new Map(domain('users', 'user_id').map(row => [String(row.source).toLowerCase(), String(row.destination)]));
  const tasks = new Map(domain('workflow_tasks', 'task_id').map(row => [String(row.destination).toLowerCase(), String(row.source)]));
  const sourceTask = (id: unknown) => {
    const source = tasks.get(String(id).toLowerCase());
    if (!source) throw new Error('Portable workflow task history has no source identity');
    return source;
  };
  const actor = (id: unknown) => typeof id === 'string' ? users.get(id.toLowerCase()) ?? null : null;
  return [
    ...prepared.records.workflow_tasks.map(row => ({ tenant: prepared.destinationTenant, audit_id: row.task_id,
      user_id: actor(row.completed_by ?? row.created_by), operation: 'portable_workflow_task_restored', table_name: 'workflow_tasks',
      record_id: row.task_id, timestamp: row.updated_at ?? row.created_at, changed_data: {},
      details: { portable_workflow_task: { ...row }, source_tenant: prepared.sourceTenant, source_task_id: sourceTask(row.task_id),
        actor_identity: 'source_tenant', execution_state: 'not_restored' } })),
    ...prepared.records.workflow_task_history.map(row => ({ tenant: prepared.destinationTenant, audit_id: row.history_id,
      user_id: actor(row.user_id), operation: 'portable_workflow_task_activity_restored', table_name: 'workflow_tasks',
      record_id: row.task_id, timestamp: row.timestamp, changed_data: {},
      details: { portable_workflow_task_activity: { ...row }, source_tenant: prepared.sourceTenant, source_task_id: sourceTask(row.task_id),
        actor_identity: 'source_tenant', execution_state: 'not_restored' } })),
  ];
}
