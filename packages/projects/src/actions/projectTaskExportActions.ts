'use server'

import type { ITag } from '@alga-psa/types';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth, throwPermissionError } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { findTagsByEntityIds } from '@alga-psa/tags/actions';
import { Knex } from 'knex';
import { extractTaskDescriptionText } from '../lib/taskRichText';

const MAX_EXPORT_ROWS = 10000;

const CSV_FIELDS = [
  'task_name',
  'description',
  'phase',
  'status',
  'is_closed',
  'task_type',
  'priority',
  'assigned_to',
  'assigned_team',
  'due_date',
  'estimated_hours',
  'actual_hours',
  'checklist_progress',
  'tags',
  'created_at',
  'updated_at',
] as const;

const CSV_HEADERS: Record<string, string> = {
  task_name: 'Task Name',
  description: 'Description',
  phase: 'Phase',
  status: 'Status',
  is_closed: 'Is Closed',
  task_type: 'Task Type',
  priority: 'Priority',
  assigned_to: 'Assigned To',
  assigned_team: 'Assigned Team',
  due_date: 'Due Date',
  estimated_hours: 'Estimated Hours',
  actual_hours: 'Actual Hours',
  checklist_progress: 'Checklist Progress',
  tags: 'Tags',
  created_at: 'Created At',
  updated_at: 'Updated At',
};

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(date.getTime())) return '';
  return date.toISOString();
}

function formatTaskType(typeKey: string | null | undefined): string {
  if (!typeKey) return '';
  // Convert snake_case keys to title case
  return typeKey
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

interface TaskRow {
  task_id: string;
  task_name: string;
  description: string | null;
  phase_id: string;
  assigned_to: string | null;
  assigned_team_id: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  project_status_mapping_id: string;
  created_at: Date;
  updated_at: Date;
  wbs_code: string;
  due_date: Date | null;
  priority_id: string | null;
  task_type_key: string;
  tenant: string;
}

interface NameLookups {
  users: Record<string, string>;
  teams: Record<string, string>;
  phases: Record<string, string>;
  statuses: Record<string, { name: string; is_closed: boolean }>;
  priorities: Record<string, string>;
  taskTypes: Record<string, string>;
}

interface ChecklistCounts {
  total: number;
  completed: number;
}

function taskToRow(
  task: TaskRow,
  lookups: NameLookups,
  taskTags: Record<string, ITag[]>,
  checklistCounts: Record<string, ChecklistCounts>,
): Record<string, string> {
  const assignedToName = task.assigned_to
    ? lookups.users[task.assigned_to] || ''
    : '';
  const assignedTeamName = task.assigned_team_id
    ? lookups.teams[task.assigned_team_id] || ''
    : '';
  const phaseName = lookups.phases[task.phase_id] || '';
  const statusInfo = lookups.statuses[task.project_status_mapping_id];
  const statusName = statusInfo?.name || '';
  const isClosed = statusInfo?.is_closed ? 'Yes' : 'No';
  const priorityName = task.priority_id
    ? lookups.priorities[task.priority_id] || ''
    : '';

  const tags = (taskTags[task.task_id] || []).map(t => t.tag_text).join(', ');

  const checklist = checklistCounts[task.task_id];
  const checklistProgress = checklist
    ? `${checklist.completed}/${checklist.total}`
    : '';

  const taskTypeName = task.task_type_key
    ? lookups.taskTypes[task.task_type_key] || formatTaskType(task.task_type_key)
    : '';

  return {
    task_name: task.task_name || '',
    description: extractTaskDescriptionText(task.description) || '',
    phase: phaseName,
    status: statusName,
    is_closed: isClosed,
    task_type: taskTypeName,
    priority: priorityName,
    assigned_to: assignedToName,
    assigned_team: assignedTeamName,
    due_date: formatDate(task.due_date),
    estimated_hours: task.estimated_hours != null ? String(task.estimated_hours) : '',
    actual_hours: task.actual_hours != null ? String(task.actual_hours) : '',
    checklist_progress: checklistProgress,
    tags,
    created_at: formatDate(task.created_at),
    updated_at: formatDate(task.updated_at),
  };
}

async function resolveNameLookups(
  trx: Knex.Transaction,
  tenant: string,
  tasks: TaskRow[],
): Promise<NameLookups> {
  const userIds = new Set<string>();
  const teamIds = new Set<string>();
  const phaseIds = new Set<string>();
  const statusMappingIds = new Set<string>();
  const priorityIds = new Set<string>();

  for (const t of tasks) {
    if (t.assigned_to) userIds.add(t.assigned_to);
    if (t.assigned_team_id) teamIds.add(t.assigned_team_id);
    phaseIds.add(t.phase_id);
    statusMappingIds.add(t.project_status_mapping_id);
    if (t.priority_id) priorityIds.add(t.priority_id);
  }

  const lookups: NameLookups = {
    users: {},
    teams: {},
    phases: {},
    statuses: {},
    priorities: {},
    taskTypes: {},
  };

  const promises: Promise<void>[] = [];

  // Resolve user names
  if (userIds.size > 0) {
    promises.push(
      trx('users')
        .select('user_id', trx.raw("CONCAT(first_name, ' ', last_name) as full_name"))
        .whereIn('user_id', Array.from(userIds))
        .andWhere('tenant', tenant)
        .then(users => {
          for (const u of users) {
            lookups.users[u.user_id] = u.full_name || '';
          }
        })
    );
  }

  // Resolve team names
  if (teamIds.size > 0) {
    promises.push(
      trx('teams')
        .select('team_id', 'team_name')
        .whereIn('team_id', Array.from(teamIds))
        .andWhere('tenant', tenant)
        .then(teams => {
          for (const t of teams) {
            lookups.teams[t.team_id] = t.team_name || '';
          }
        })
    );
  }

  // Resolve phase names
  if (phaseIds.size > 0) {
    promises.push(
      trx('project_phases')
        .select('phase_id', 'phase_name')
        .whereIn('phase_id', Array.from(phaseIds))
        .andWhere('tenant', tenant)
        .then(phases => {
          for (const p of phases) {
            lookups.phases[p.phase_id] = p.phase_name || '';
          }
        })
    );
  }

  // Resolve status names via project_status_mappings
  if (statusMappingIds.size > 0) {
    promises.push(
      trx('project_status_mappings as psm')
        .leftJoin('statuses as s', function (this: Knex.JoinClause) {
          this.on('psm.status_id', '=', 's.status_id').andOn('psm.tenant', '=', 's.tenant');
        })
        .leftJoin('standard_statuses as ss', function (this: Knex.JoinClause) {
          this.on('psm.standard_status_id', '=', 'ss.standard_status_id').andOn('psm.tenant', '=', 'ss.tenant');
        })
        .whereIn('psm.project_status_mapping_id', Array.from(statusMappingIds))
        .andWhere('psm.tenant', tenant)
        .select(
          'psm.project_status_mapping_id',
          trx.raw("COALESCE(psm.custom_name, s.name, ss.name, psm.project_status_mapping_id::text) as status_name"),
          trx.raw('COALESCE(s.is_closed, ss.is_closed, false) as is_closed'),
        )
        .then(rows => {
          for (const r of rows) {
            lookups.statuses[r.project_status_mapping_id] = {
              name: r.status_name || '',
              is_closed: Boolean(r.is_closed),
            };
          }
        })
    );
  }

  // Resolve priority names
  if (priorityIds.size > 0) {
    promises.push(
      trx('priorities')
        .select('priority_id', 'priority_name')
        .whereIn('priority_id', Array.from(priorityIds))
        .andWhere('tenant', tenant)
        .then(priorities => {
          for (const p of priorities) {
            lookups.priorities[p.priority_id] = p.priority_name || '';
          }
        })
    );
  }

  // Resolve task type names (standard + custom)
  promises.push(
    Promise.all([
      trx('standard_task_types')
        .select('type_key', 'type_name')
        .where('is_active', true),
      trx('custom_task_types')
        .select('type_key', 'type_name')
        .where({ tenant, is_active: true }),
    ]).then(([standard, custom]) => {
      for (const t of standard) {
        lookups.taskTypes[t.type_key] = t.type_name || '';
      }
      // Custom overrides standard
      for (const t of custom) {
        lookups.taskTypes[t.type_key] = t.type_name || '';
      }
    })
  );

  await Promise.all(promises);
  return lookups;
}

export const exportProjectTasksToCSV = withAuth(async (
  _user,
  { tenant },
  projectId: string,
  selectedPhaseIds: string[],
  selectedFields?: string[],
): Promise<{ csv: string; count: number }> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const hasRead = await hasPermission(_user, 'project', 'read', trx);
    if (!hasRead) {
      throwPermissionError('read project');
    }

    // Get phases for this project, filtered to selected ones
    const phases = await trx('project_phases')
      .where({ project_id: projectId, tenant })
      .whereIn('phase_id', selectedPhaseIds)
      .select('phase_id');

    const phaseIds = phases.map(p => p.phase_id);
    if (phaseIds.length === 0) {
      return { csv: '', count: 0 };
    }

    // Get all tasks for selected phases
    const tasks: TaskRow[] = await trx('project_tasks')
      .whereIn('phase_id', phaseIds)
      .andWhere('tenant', tenant)
      .orderBy(['phase_id', 'order_key'])
      .limit(MAX_EXPORT_ROWS);

    if (tasks.length === 0) {
      return { csv: '', count: 0 };
    }

    const taskIds = tasks.map(t => t.task_id);

    // Resolve lookups, tags, and checklist counts in parallel
    const [lookups, tagsArray, checklistRows] = await Promise.all([
      resolveNameLookups(trx, tenant, tasks),
      findTagsByEntityIds(taskIds, 'project_task').catch(() => []),
      trx('task_checklist_items')
        .whereIn('task_id', taskIds)
        .andWhere('tenant', tenant)
        .select('task_id', 'completed'),
    ]);

    // Build tag map
    const taskTags: Record<string, ITag[]> = {};
    for (const tag of tagsArray) {
      if (tag.tagged_id) {
        (taskTags[tag.tagged_id] ??= []).push(tag);
      }
    }

    // Build checklist counts map
    const checklistCounts: Record<string, ChecklistCounts> = {};
    for (const item of checklistRows) {
      if (!checklistCounts[item.task_id]) {
        checklistCounts[item.task_id] = { total: 0, completed: 0 };
      }
      checklistCounts[item.task_id].total++;
      if (item.completed) {
        checklistCounts[item.task_id].completed++;
      }
    }

    const rows = tasks.map(t => taskToRow(t, lookups, taskTags, checklistCounts));

    // Use selected fields if provided, otherwise all fields
    const allFieldKeys = CSV_FIELDS as readonly string[];
    const fields = selectedFields
      ? selectedFields.filter(f => allFieldKeys.includes(f))
      : [...CSV_FIELDS] as string[];

    if (fields.length === 0) {
      return { csv: '', count: 0 };
    }

    // Build header row using friendly names
    const headerRow = fields.map(f => CSV_HEADERS[f] || f);
    const dataRows = rows.map(row =>
      fields.map(f => row[f] || '')
    );

    const escapeField = (field: string): string => {
      let str = String(field);
      // Guard against CSV injection: prefix dangerous leading characters with a single quote
      if (/^[=+\-@\t\r]/.test(str)) {
        str = "'" + str;
      }
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvLines = [
      headerRow.map(escapeField).join(','),
      ...dataRows.map(row => row.map(escapeField).join(','))
    ];

    return { csv: csvLines.join('\n'), count: tasks.length };
  });
});
