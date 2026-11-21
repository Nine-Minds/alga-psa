import type { ProjectTaskSummary } from "../api/projects";

export type TaskAssigneeFilter = "any" | "me" | "unassigned" | { userId: string };

export type ProjectTaskFilters = {
  /** Free text matched against name, description, WBS code and assignee. */
  query: string;
  /** Status mapping ids; empty means every status. */
  statusMappingIds: string[];
  assignee: TaskAssigneeFilter;
};

export const EMPTY_TASK_FILTERS: ProjectTaskFilters = { query: "", statusMappingIds: [], assignee: "any" };

export function hasActiveTaskFilters(filters: ProjectTaskFilters): boolean {
  return (
    normalizeTaskQuery(filters.query).length > 0 || filters.statusMappingIds.length > 0 || filters.assignee !== "any"
  );
}

export function normalizeTaskQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Every word of the query has to appear somewhere in the task's text. */
export function taskMatchesQuery(task: ProjectTaskSummary, normalizedQuery: string, assigneeName?: string | null): boolean {
  if (!normalizedQuery) return true;
  const haystack = [task.task_name, task.description, task.wbs_code, assigneeName ?? task.assigned_user_name]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n")
    .toLowerCase();
  return normalizedQuery.split(" ").every((word) => haystack.includes(word));
}

export function taskMatchesAssignee(
  task: ProjectTaskSummary,
  assignee: TaskAssigneeFilter,
  meUserId: string | null,
): boolean {
  if (assignee === "any") return true;
  if (assignee === "unassigned") return !task.assigned_to;
  if (assignee === "me") return Boolean(meUserId) && task.assigned_to === meUserId;
  return task.assigned_to === assignee.userId;
}

export function filterProjectTasks(
  tasks: ProjectTaskSummary[],
  filters: ProjectTaskFilters,
  context: { meUserId: string | null; assigneeNames: Map<string, string> },
): ProjectTaskSummary[] {
  const query = normalizeTaskQuery(filters.query);
  const statuses = new Set(filters.statusMappingIds);
  return tasks.filter((task) => {
    if (statuses.size > 0 && !(task.project_status_mapping_id && statuses.has(task.project_status_mapping_id))) {
      return false;
    }
    if (!taskMatchesAssignee(task, filters.assignee, context.meUserId)) return false;
    const assigneeName = task.assigned_to ? context.assigneeNames.get(task.assigned_to) : null;
    return taskMatchesQuery(task, query, assigneeName);
  });
}

export type AssigneeOption = { userId: string; name: string; count: number };

/** People with tasks in this project, busiest first, for the assignee chips. */
export function assigneeOptions(tasks: ProjectTaskSummary[], names: Map<string, string>): AssigneeOption[] {
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.assigned_to) counts.set(task.assigned_to, (counts.get(task.assigned_to) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([userId, count]) => ({ userId, count, name: names.get(userId) ?? userId }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
