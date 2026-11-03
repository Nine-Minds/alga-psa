import type { Knex } from 'knex';
import type { IProjectTask } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';
import {
  coManagedColumnHidden,
  coManagedHiddenColumns,
  coManagedProjectFamilyMask,
  CO_MANAGED_TASK_COLUMNS,
} from '@alga-psa/co-managed/projectFieldMask';
import { CO_MANAGED_ASSIGNEE_NAME_ALIASES } from '@alga-psa/co-managed/sharedWorkProjection';

function tenantScopedTable(conn: Knex | Knex.Transaction, table: string, tenant: string): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

export async function loadAuthorizedProjectTasks(
  trx: Knex.Transaction,
  tenant: string,
  projectId: string,
  redactedFields: string[],
  taskIds?: string[],
): Promise<Array<IProjectTask & { assigned_to_name: string | null; project_id: string }>> {
  const mask = coManagedProjectFamilyMask(redactedFields, 'project_task');
  if (mask.dropRow) return [];
  const fields = [
    'tenant', 'task_id', 'phase_id', 'task_name', 'description', 'description_rich_text', 'assigned_to',
    'assigned_team_id', 'estimated_hours', 'actual_hours', 'project_status_mapping_id', 'created_at', 'updated_at',
    'wbs_code', 'order_key', 'start_date', 'due_date', 'priority_id', 'task_type_key', 'service_id',
  ];
  const hidden = coManagedHiddenColumns(redactedFields, 'project_tasks', CO_MANAGED_TASK_COLUMNS);
  const aliasesByField: Record<string, string[]> = {
    project_status_mapping_id: ['status', 'statuses', 'project_status_mappings', 'mapping_id'],
    priority_id: ['priority', 'priority_name'],
    assigned_to: ['assignee', 'assignee_name', 'assigned_to_name', 'users', 'teams'],
    assigned_team_id: ['assignee', 'assigned_to_name', 'teams'],
  };
  for (const field of fields) {
    if (coManagedColumnHidden(redactedFields, 'project_tasks', field, aliasesByField[field] ?? []) || (mask.body && field.startsWith('description'))) {
      hidden.add(field);
    }
  }
  const maskColumn = (field: string, type: string) => hidden.has(field)
    ? trx.raw(`NULL::${type} as ??`, [field])
    : `project_tasks.${field}`;
  const db = tenantDb(trx, tenant);
  if (taskIds && taskIds.length === 0) return [];
  const query = tenantScopedTable(trx, 'project_tasks', tenant);
  db.tenantJoin(query, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
  db.tenantJoin(query, 'users', 'project_tasks.assigned_to', 'users.user_id', { type: 'left' });
  const taskName = mask.title
    ? trx.raw('?::text as task_name', [mask.neutralTitle])
    : maskColumn('task_name', 'text');
  const assignedNameHidden = hidden.has('assigned_to') || hidden.has('assigned_team_id') ||
    coManagedColumnHidden(redactedFields, 'project_tasks', 'assigned_to_name', CO_MANAGED_ASSIGNEE_NAME_ALIASES);
  const assignedName = assignedNameHidden
    ? trx.raw('NULL::text as assigned_to_name')
    : trx.raw("CONCAT(users.first_name, ' ', users.last_name) as assigned_to_name");
  query.where('project_phases.project_id', projectId);
  if (taskIds) query.whereIn('project_tasks.task_id', taskIds);
  const rows = await query
    .select(
      ...fields.filter((field) => field !== 'task_name').map((field) => maskColumn(field, field === 'estimated_hours' || field === 'actual_hours' ? 'numeric' :
        ['created_at', 'updated_at', 'start_date', 'due_date'].includes(field) ? 'timestamptz' : 'text')),
      taskName,
      'project_phases.project_id as project_id',
      assignedName,
    )
    .orderBy(hidden.has('wbs_code') ? 'project_tasks.task_id' : 'project_tasks.wbs_code') as Array<IProjectTask & { assigned_to_name: string | null; project_id: string }>;
  if (!hidden.has('wbs_code')) {
    rows.sort((a, b) => {
      const left = a.wbs_code.split('.').map(Number), right = b.wbs_code.split('.').map(Number);
      for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
        if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0);
      }
      return 0;
    });
  }
  return rows;
}

