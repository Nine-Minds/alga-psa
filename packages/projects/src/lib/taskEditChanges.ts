import type { IProjectTask } from '@alga-psa/types';

/** The form's current values, in the form's own units (hours, Date). */
export interface TaskEditFormValues {
  taskName: string;
  /** Serialized description, compared as a string against `loadedDescriptionSerialized`. */
  descriptionSerialized: string;
  loadedDescriptionSerialized: string;
  statusId: string | null | undefined;
  phaseId: string | null | undefined;
  assignedTo: string | null;
  assignedTeamId: string | null;
  estimatedHours: number;
  startDate: Date | undefined | null;
  dueDate: Date | undefined | null;
  priorityId: string | null;
  taskTypeKey: string;
  serviceId: string | null;
  checklistItems: unknown[];
  checklistModified: boolean;
  /** Optional collections; omitted from the request when `undefined` (the form did not load them). */
  resources?: unknown;
  tags?: unknown;
  dependencies?: unknown;
  ticketLinks?: unknown;
}

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const norm = (value: string | null | undefined): string | null => (value ? value : null);

/** Only the fields that differ from the loaded task, by `project_tasks` column name. */
export function computeTaskEditChanges(task: IProjectTask, v: TaskEditFormValues): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  if (v.taskName !== task.task_name) changes.task_name = v.taskName;
  if (v.descriptionSerialized !== v.loadedDescriptionSerialized) changes.description = v.descriptionSerialized;
  if (v.statusId && v.statusId !== task.project_status_mapping_id) changes.project_status_mapping_id = v.statusId;
  if (v.phaseId && v.phaseId !== task.phase_id) changes.phase_id = v.phaseId;
  if (norm(v.assignedTo) !== norm(task.assigned_to)) changes.assigned_to = norm(v.assignedTo);
  if (norm(v.assignedTeamId) !== norm(task.assigned_team_id)) changes.assigned_team_id = norm(v.assignedTeamId);
  const minutes = Math.round(v.estimatedHours * 60);
  if (minutes !== (Number(task.estimated_hours) || 0)) changes.estimated_hours = minutes;
  if (toIso(v.startDate) !== toIso(task.start_date as Date | string | null)) changes.start_date = toIso(v.startDate);
  if (toIso(v.dueDate) !== toIso(task.due_date as Date | string | null)) changes.due_date = toIso(v.dueDate);
  if (norm(v.priorityId) !== norm(task.priority_id)) changes.priority_id = norm(v.priorityId);
  if (v.taskTypeKey !== (task.task_type_key || 'task')) changes.task_type_key = v.taskTypeKey;
  if (norm(v.serviceId) !== norm(task.service_id)) changes.service_id = norm(v.serviceId);
  if (v.checklistModified) changes.checklist_items = v.checklistItems;
  if (v.resources !== undefined) changes.resources = v.resources;
  if (v.tags !== undefined) changes.tags = v.tags;
  if (v.dependencies !== undefined) changes.dependencies = v.dependencies;
  if (v.ticketLinks !== undefined) changes.ticket_links = v.ticketLinks;
  return changes;
}

/** Stable signature of a changes object (key order independent), so a retry of the same edit reuses its operation id. */
export function taskEditSignature(taskId: string, changes: Record<string, unknown>): string {
  const sorted = Object.keys(changes).sort().map((k) => [k, changes[k]]);
  return `${taskId}:${JSON.stringify(sorted)}`;
}

export const TASK_FIELD_LABELS: Record<string, { key: string; fallback: string }> = {
  task_name: { key: 'taskName', fallback: 'Task name' },
  description: { key: 'description', fallback: 'Description' },
  project_status_mapping_id: { key: 'status', fallback: 'Status' },
  phase_id: { key: 'phase', fallback: 'Phase' },
  assigned_to: { key: 'assignee', fallback: 'Assignee' },
  assigned_team_id: { key: 'team', fallback: 'Team' },
  estimated_hours: { key: 'estimatedHours', fallback: 'Estimated hours' },
  start_date: { key: 'startDate', fallback: 'Start date' },
  due_date: { key: 'dueDate', fallback: 'Due date' },
  priority_id: { key: 'priority', fallback: 'Priority' },
  task_type_key: { key: 'taskType', fallback: 'Task type' },
  service_id: { key: 'service', fallback: 'Service' },
  checklist_items: { key: 'checklist', fallback: 'Checklist' },
  tags: { key: 'tags', fallback: 'Tags' },
  resources: { key: 'additionalAgents', fallback: 'Additional agents' },
  dependencies: { key: 'dependencies', fallback: 'Dependencies' },
  ticket_links: { key: 'ticketLinks', fallback: 'Ticket links' },
};

/** Human-readable labels for refused fields, translated through `translate(key, fallback)`. Unknown fields fall back to the column name. */
export function refusedFieldLabels(
  fields: readonly string[],
  translate: (key: string, fallback: string) => string,
): string[] {
  return fields.map((f) => {
    const label = TASK_FIELD_LABELS[f];
    return label ? translate(`refusedFields.${label.key}`, label.fallback) : f;
  });
}
