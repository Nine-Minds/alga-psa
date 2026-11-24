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
): Promise<Array<IProjectTask & {
  assigned_to_name: string | null;
  project_id: string;
  status_name: string | null;
  is_closed: boolean | null;
  status_color: string | null;
  priority_name: string | null;
  priority_color: string | null;
}>> {
  const mask = coManagedProjectFamilyMask(redactedFields, 'project_task');
  if (mask.dropRow) return [];
  const fields = [
    'tenant', 'task_id', 'phase_id', 'task_name', 'description', 'description_rich_text', 'assigned_to',
    'assigned_team_id', 'estimated_hours', 'actual_hours', 'project_status_mapping_id', 'created_at', 'updated_at',
    'wbs_code', 'order_key', 'start_date', 'due_date', 'priority_id', 'task_type_key', 'service_id',
  ];
  const hidden = coManagedHiddenColumns(redactedFields, 'project_tasks', CO_MANAGED_TASK_COLUMNS);
  const derivedAliases: Record<string, string[]> = {
    status_name: ['statusName', 'status'],
    is_closed: ['isClosed', 'closed'],
    status_color: ['statusColor', 'color'],
    priority_name: ['priorityName', 'priority'],
    priority_color: ['priorityColor', 'color'],
  };
  for (const [field, aliases] of Object.entries(derivedAliases)) {
    if (coManagedColumnHidden(redactedFields, 'project_tasks', field, aliases)) hidden.add(field);
  }
  const aliasesByField: Record<string, string[]> = {
    project_status_mapping_id: ['status', 'status_name', 'statuses', 'project_status_mappings', 'mapping_id', 'statusMappingId'],
    priority_id: ['priority', 'priority_name', 'priority_color', 'priorityColor'],
    assigned_to: ['assignee', 'assignee_name', 'assigned_to_name', 'users', 'teams'],
    assigned_team_id: ['assignee', 'assigned_to_name', 'teams'],
  };
  for (const field of fields) {
    if (coManagedColumnHidden(redactedFields, 'project_tasks', field,
      field === 'wbs_code' ? ['wbsCode'] : aliasesByField[field] ?? []) || (mask.body && field.startsWith('description'))) {
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
  db.tenantJoin(query, 'project_status_mappings as psm', 'project_tasks.project_status_mapping_id', 'psm.project_status_mapping_id', {
    type: 'left',
    on: (join) => join.andOn('psm.project_id', '=', 'project_phases.project_id')
      .andOn(function () { this.onNull('psm.phase_id').orOn('psm.phase_id', '=', 'project_tasks.phase_id'); }),
  });
  db.tenantJoin(query, 'statuses as cs', 'psm.status_id', 'cs.status_id', { type: 'left' });
  db.tenantJoin(query, 'standard_statuses as ss', 'psm.standard_status_id', 'ss.standard_status_id', { type: 'left' });
  db.tenantJoin(query, 'priorities', 'project_tasks.priority_id', 'priorities.priority_id', { type: 'left' });
  const taskName = mask.title
    ? trx.raw('?::text as task_name', [mask.neutralTitle])
    : maskColumn('task_name', 'text');
  const assignedNameHidden = hidden.has('assigned_to') || hidden.has('assigned_team_id') ||
    coManagedColumnHidden(redactedFields, 'project_tasks', 'assigned_to_name', CO_MANAGED_ASSIGNEE_NAME_ALIASES);
  const assignedName = assignedNameHidden
    ? trx.raw('NULL::text as assigned_to_name')
    : trx.raw("CONCAT(users.first_name, ' ', users.last_name) as assigned_to_name");
  const maskedDerived = (field: string, expression: string, type: 'text' | 'boolean') => hidden.has(field)
    ? trx.raw(`NULL::${type} as ??`, [field])
    : trx.raw(`${expression} as ??`, [field]);
  query.where('project_phases.project_id', projectId);
  if (taskIds) query.whereIn('project_tasks.task_id', taskIds);
  const rows = await query
    .select(
      ...fields.filter((field) => field !== 'task_name').map((field) => maskColumn(field, field === 'estimated_hours' || field === 'actual_hours' ? 'numeric' :
        ['created_at', 'updated_at', 'start_date', 'due_date'].includes(field) ? 'timestamptz' : 'text')),
      taskName,
      'project_phases.project_id as project_id',
      assignedName,
      maskedDerived('status_name', 'COALESCE(psm.custom_name, cs.name, ss.name)', 'text'),
      maskedDerived('is_closed', 'CASE WHEN psm.project_status_mapping_id IS NULL THEN NULL ELSE COALESCE(cs.is_closed, ss.is_closed, false) END', 'boolean'),
      maskedDerived('status_color', 'cs.color', 'text'),
      maskedDerived('priority_name', 'priorities.priority_name', 'text'),
      maskedDerived('priority_color', 'priorities.color', 'text'),
    )
    .orderBy(hidden.has('wbs_code') ? 'project_tasks.task_id' : 'project_tasks.wbs_code') as Array<IProjectTask & {
      assigned_to_name: string | null;
      project_id: string;
      status_name: string | null;
      is_closed: boolean | null;
      status_color: string | null;
      priority_name: string | null;
      priority_color: string | null;
    }>;
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

