import { extractTaskDescriptionText } from './taskRichText';

/** Only the task fields the filters read, so callers can pass any task shape. */
export interface FilterableTask {
  task_id: string;
  task_name: string;
  description?: string | null;
  description_rich_text?: string | null;
  priority_id?: string | null;
  task_type_key?: string | null;
  assigned_to?: string | null;
  assigned_team_id?: string | null;
}

export interface TaskFilterCriteria {
  searchQuery?: string;
  searchWholeWord?: boolean;
  searchCaseSensitive?: boolean;
  /** Priority id, or 'all' / undefined for no priority filter. */
  priorityId?: string;
  /** Task type key, or 'all' / undefined for no task-type filter. */
  taskTypeKey?: string;
  /** Tag texts; a task matches when it carries any of them. */
  tags?: string[];
  agentIds?: string[];
  teamIds?: string[];
  includeUnassigned?: boolean;
  /** Ignores additional agents, applicable only when exactly one agent is selected. */
  primaryAgentOnly?: boolean;
}

export interface TaskFilterContext {
  /** Tags per task id. */
  tags?: Record<string, { tag_text: string }[]>;
  /** Task resources (additional agents) per task id. */
  resources?: Record<string, { additional_user_id?: string | null }[]>;
  /**
   * Plain-text description per task, so callers that already memoized the
   * rich-text extraction don't pay for it again on every filter pass.
   */
  descriptionText?: (task: FilterableTask) => string;
}

const descriptionTextOf = (task: FilterableTask, ctx?: TaskFilterContext): string =>
  ctx?.descriptionText
    ? ctx.descriptionText(task)
    : extractTaskDescriptionText(task.description_rich_text ?? task.description);

const escapeForRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchesSearch = (task: FilterableTask, criteria: TaskFilterCriteria, ctx?: TaskFilterContext): boolean => {
  const searchQuery = criteria.searchQuery ?? '';
  if (!searchQuery.trim()) return true;

  const { searchCaseSensitive, searchWholeWord } = criteria;
  const query = searchCaseSensitive ? searchQuery : searchQuery.toLowerCase();
  const descText = descriptionTextOf(task, ctx);

  if (searchWholeWord) {
    const wordRegex = new RegExp(`\\b${escapeForRegExp(query)}\\b`, searchCaseSensitive ? '' : 'i');
    return wordRegex.test(task.task_name) || wordRegex.test(descText);
  }

  const taskName = searchCaseSensitive ? task.task_name : task.task_name.toLowerCase();
  const taskDescription = searchCaseSensitive ? descText : descText.toLowerCase();
  return taskName.includes(query) || taskDescription.includes(query);
};

const matchesTags = (task: FilterableTask, criteria: TaskFilterCriteria, ctx?: TaskFilterContext): boolean => {
  const selectedTags = criteria.tags ?? [];
  if (selectedTags.length === 0) return true;

  const tagTexts = (ctx?.tags?.[task.task_id] ?? []).map(tag => tag.tag_text);
  return selectedTags.some(selectedTag => tagTexts.includes(selectedTag));
};

const matchesAssignment = (task: FilterableTask, criteria: TaskFilterCriteria, ctx?: TaskFilterContext): boolean => {
  const agentIds = criteria.agentIds ?? [];
  const teamIds = criteria.teamIds ?? [];
  const includeUnassigned = criteria.includeUnassigned ?? false;

  if (agentIds.length === 0 && teamIds.length === 0 && !includeUnassigned) return true;

  // Unassigned tasks (no primary assignee) are opted in explicitly
  if (includeUnassigned && !task.assigned_to) return true;

  if (agentIds.length > 0) {
    // Primary assignee
    if (task.assigned_to && agentIds.includes(task.assigned_to)) return true;

    // Additional agents from task resources, unless filtering for the primary
    // assignee only — which only applies when exactly one agent is selected
    if (!(criteria.primaryAgentOnly && agentIds.length === 1)) {
      const resources = ctx?.resources?.[task.task_id] ?? [];
      if (resources.some(resource => resource.additional_user_id && agentIds.includes(resource.additional_user_id))) {
        return true;
      }
    }
  }

  // Teams match on the task's assigned team
  if (teamIds.length > 0 && task.assigned_team_id && teamIds.includes(task.assigned_team_id)) return true;

  return false;
};

/**
 * The single task-filter predicate behind the project list, board, Gantt and
 * every derived count, so those views can never disagree about which tasks a
 * filter leaves visible.
 */
export function matchesTaskFilters(
  task: FilterableTask,
  criteria: TaskFilterCriteria,
  ctx?: TaskFilterContext,
): boolean {
  if (!matchesSearch(task, criteria, ctx)) return false;

  if (criteria.priorityId && criteria.priorityId !== 'all' && task.priority_id !== criteria.priorityId) {
    return false;
  }

  if (criteria.taskTypeKey && criteria.taskTypeKey !== 'all' && task.task_type_key !== criteria.taskTypeKey) {
    return false;
  }

  if (!matchesTags(task, criteria, ctx)) return false;

  return matchesAssignment(task, criteria, ctx);
}

export function filterTasks<T extends FilterableTask>(
  tasks: T[],
  criteria: TaskFilterCriteria,
  ctx?: TaskFilterContext,
): T[] {
  return tasks.filter(task => matchesTaskFilters(task, criteria, ctx));
}
