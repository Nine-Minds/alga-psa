import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import {
  Activity,
  ActivityFilters,
  ActivityResponse,
  ActivityType,
  ActivityPriority,
  ProjectTaskActivity,
  NotificationActivity,
  scheduleEntryToActivity,
  timeEntryToActivity,
} from '@alga-psa/types';
// Identity-explicit core (NOT the withAuth `getScheduleActivityEntries`): the v1 REST API
// resolves the user from an API key, so withAuth — which reads the NextAuth session — would
// throw and the catch below would silently drop every schedule + ad-hoc item. The caller has
// already gated `targetUserId` via resolveActivityTarget.
import { getScheduleActivityEntriesForUser } from '@alga-psa/scheduling/actions/scheduleActivityCore';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { isFeatureFlagEnabled } from '@alga-psa/core';
import { ISO8601String } from '@alga-psa/types';
import { IUserWithRoles } from '@alga-psa/types';
import { loadAuthorizedProjectTaskActivities } from '@alga-psa/projects/activityRead';

// Workflow tasks are the only EE-specific activity source. The base package resolves
// this to a CE stub (returns []); the EE app build aliases the specifier to the real
// implementation. This keeps `@alga-psa/user-activities` free of `@alga-psa/workflows`.
import { fetchWorkflowTaskActivities } from '@alga-psa/user-activities/server/workflow-tasks';
export { fetchWorkflowTaskActivities };

// Configurable notification priorities (task 29.8.46): map the stored priority
// to the activity tier, with legacy type-fallback. Kept in its own typed module
// so it stays independently unit-testable.
import { mapStoredNotificationPriority } from './notificationPriority';
import { collapseRecurringSeries } from '../lib/recurringSeries';
import { whereProjectTaskOnUsersList, whereTicketOnUsersList } from './activityAssignmentScope';

// Enhanced in-memory cache implementation with different TTLs and invalidation
const cache = {
  data: new Map<string, { value: string; expiry: number; tags: string[] }>(),
  
  // Default TTLs in seconds
  ttl: {
    DEFAULT: 60, // 1 minute
    DRAWER: 600, // 10 minutes for drawer operations
    LIST: 300,   // 5 minutes for list views
  },
  
  async get(key: string): Promise<string | null> {
    const item = this.data.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
      this.data.delete(key);
      return null;
    }
    
    return item.value;
  },
  
  async set(key: string, value: string, ttlSeconds?: number, tags: string[] = []): Promise<void> {
    const expiry = Date.now() + (ttlSeconds || this.ttl.DEFAULT) * 1000;
    this.data.set(key, { value, expiry, tags });
  },
  
  // Invalidate cache entries by tag
  async invalidateByTag(tag: string): Promise<void> {
    for (const [key, item] of this.data.entries()) {
      if (item.tags.includes(tag)) {
        this.data.delete(key);
      }
    }
  },
  
  // Invalidate all cache entries for a specific activity type
  async invalidateByType(type: ActivityType): Promise<void> {
    await this.invalidateByTag(`type:${type}`);
  },
  
  // Invalidate all cache entries for a specific user
  async invalidateByUser(userId: string): Promise<void> {
    await this.invalidateByTag(`user:${userId}`);
  }
};

// Helper function to convert ISO string to plain date
function toPlainDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toISOString().split('T')[0];
}

type ScheduleEntryWorkItemLink = {
  work_item_type?: string | null;
  work_item_id?: string | null;
};

async function filterScheduleEntriesByClient<T extends ScheduleEntryWorkItemLink>(
  knex: Knex,
  tenant: string,
  entries: T[],
  clientId: string
): Promise<T[]> {
  // The truthiness check inside filter() does not narrow the mapped element
  // type, so these collapsed to (string | null | undefined)[] and knex resolved
  // whereIn() to its composite-column overload. Narrow after mapping instead.
  const isId = (id: unknown): id is string => typeof id === 'string' && id.length > 0;
  const ticketIds = [
    ...new Set(
      entries
        .filter((entry) => entry.work_item_type === 'ticket')
        .map((entry) => entry.work_item_id)
        .filter(isId)
    ),
  ];
  const projectTaskIds = [
    ...new Set(
      entries
        .filter((entry) => entry.work_item_type === 'project_task')
        .map((entry) => entry.work_item_id)
        .filter(isId)
    ),
  ];

  const scopedDb = tenantDb(knex, tenant);
  const [matchingTicketIds, matchingProjectTaskIds] = await Promise.all([
    ticketIds.length > 0
      ? scopedDb.table('tickets')
          .where({ client_id: clientId })
          .whereIn('ticket_id', ticketIds)
          .pluck('ticket_id')
      : Promise.resolve([]),
    projectTaskIds.length > 0
      ? scopedDb.table('project_tasks')
          .modify((queryBuilder) => {
            scopedDb.tenantJoin(
              queryBuilder,
              'project_phases',
              'project_tasks.phase_id',
              'project_phases.phase_id'
            );
            scopedDb.tenantJoin(
              queryBuilder,
              'projects',
              'project_phases.project_id',
              'projects.project_id'
            );
          })
          .where('projects.client_id', clientId)
          .whereIn('project_tasks.task_id', projectTaskIds)
          .pluck('project_tasks.task_id')
      : Promise.resolve([]),
  ]);

  const matchingTicketIdSet = new Set(matchingTicketIds);
  const matchingProjectTaskIdSet = new Set(matchingProjectTaskIds);

  return entries.filter((entry) => {
    if (!entry.work_item_id) return false;
    if (entry.work_item_type === 'ticket') {
      return matchingTicketIdSet.has(entry.work_item_id);
    }
    if (entry.work_item_type === 'project_task') {
      return matchingProjectTaskIdSet.has(entry.work_item_id);
    }
    return false;
  });
}

/**
 * Resolve whose activities to fetch. Defaults to the caller; when filters.targetUserId
 * names another internal user, require the same gate the schedule calendar uses to view
 * other users' calendars (user_schedule:update or user_schedule:read_all).
 */
async function resolveActivityTarget(
  user: any,
  tenantId: string,
  targetUserId?: string
): Promise<{ userId: string; viewingOther: boolean }> {
  if (!targetUserId || targetUserId === user.user_id) {
    return { userId: user.user_id, viewingOther: false };
  }

  const { knex, tenant } = await createTenantKnex(tenantId);
  const [canUpdate, canReadAll] = await Promise.all([
    hasPermission(user, 'user_schedule', 'update', knex),
    hasPermission(user, 'user_schedule', 'read_all', knex),
  ]);
  if (!canUpdate && !canReadAll) {
    throw new Error("Permission denied: cannot view another user's activities");
  }

  const target = await tenantDb(knex, tenant).table('users')
    .where({ user_id: targetUserId, user_type: 'internal' })
    .first();
  if (!target) {
    throw new Error('User not found');
  }

  return { userId: targetUserId, viewingOther: true };
}

/**
 * Fetch all activities for a user with optional filters and pagination
 */
export const fetchUserActivities = withAuth(async (
  user,
  { tenant },
  filters: ActivityFilters = {},
  page: number = 1,
  pageSize: number = 10
): Promise<ActivityResponse> => {
  return fetchUserActivitiesForApi(user, tenant, filters, page, pageSize);
});

/**
 * Fetch every requested activity type for the (resolved) user, combine them, then apply
 * cross-type filtering + sorting via processActivities. Shared by the paginated list and
 * the grouped view so both operate over an identical, fully-sorted result set. Ad-hoc
 * entries are surfaced via fetchScheduleActivities regardless of the date window.
 */
async function collectProcessedActivities(
  user: any,
  tenantId: string,
  filters: ActivityFilters
): Promise<{ activities: Activity[]; effectiveUserId: string; typesToFetch: ActivityType[] }> {
  // Determine whose activities to fetch (self, or another user if permitted).
  const { userId: effectiveUserId, viewingOther } =
    await resolveActivityTarget(user, tenantId, filters.targetUserId);

  const promises: Promise<Activity[]>[] = [];

  // Only fetch requested activity types or all if not specified.
  // Note: An empty array is truthy, so we need to check length explicitly.
  let typesToFetch = filters.types && filters.types.length > 0
    ? filters.types
    : Object.values(ActivityType);

  // Notifications and time entries are personal; never expose them when viewing
  // another user's activities.
  if (viewingOther) {
    typesToFetch = typesToFetch.filter(
      (type) => type !== ActivityType.NOTIFICATION && type !== ActivityType.TIME_ENTRY
    );
  }

  if (typesToFetch.includes(ActivityType.SCHEDULE)) {
    promises.push(fetchScheduleActivities(effectiveUserId, tenantId, filters));
    // Opportunity next actions use the schedule-compatible activity shape so
    // they render in the existing feed without adding a UI section in this lane.
    promises.push(fetchOpportunityActivities(effectiveUserId, tenantId, filters));
    // Marketing manual-publish queue (flag + marketing:manage gated inside).
    promises.push(fetchMarketingActivities(effectiveUserId, tenantId, filters, user));
  }
  if (typesToFetch.includes(ActivityType.PROJECT_TASK)) {
    promises.push(fetchProjectActivities(effectiveUserId, tenantId, filters, user));
  }
  if (typesToFetch.includes(ActivityType.TICKET)) {
    promises.push(fetchTicketActivities(effectiveUserId, tenantId, filters));
  }
  if (typesToFetch.includes(ActivityType.TIME_ENTRY)) {
    promises.push(fetchTimeEntryActivities(effectiveUserId, tenantId, filters));
  }
  if (typesToFetch.includes(ActivityType.WORKFLOW_TASK)) {
    promises.push(fetchWorkflowTaskActivities(effectiveUserId, tenantId, filters));
  }
  if (typesToFetch.includes(ActivityType.NOTIFICATION)) {
    promises.push(fetchNotificationActivities(effectiveUserId, tenantId, filters));
  }

  const results = await Promise.all(promises);
  const activities: Activity[] = [];
  results.forEach(result => activities.push(...result));

  return { activities: processActivities(activities, filters), effectiveUserId, typesToFetch };
}

/**
 * Core (identity-explicit) implementation of the unified activity fetch. Shared by the
 * `withAuth` web wrapper above and the v1 REST API, which resolves the user from an API
 * key and calls this directly under `runWithTenant`. Fans out to the per-type fetchers,
 * applies cross-type filtering/sorting, and paginates.
 */
export async function fetchUserActivitiesForApi(
  user: any,
  tenantId: string,
  filters: ActivityFilters = {},
  page: number = 1,
  pageSize: number = 10
): Promise<ActivityResponse> {
  const { activities: processedActivities, effectiveUserId, typesToFetch } =
    await collectProcessedActivities(user, tenantId, filters);

  const totalCount = processedActivities.length;
  const pageCount = Math.ceil(totalCount / pageSize);
  const startIndex = (page - 1) * pageSize;
  const paginatedActivities = processedActivities.slice(startIndex, startIndex + pageSize);

  const response: ActivityResponse = {
    activities: paginatedActivities,
    totalCount,
    pageCount,
    pageSize,
    pageNumber: page,
  };

  // In-memory cache keyed on whose activities these are + filters + page.
  const cacheKey = `user-activities:${effectiveUserId}:${JSON.stringify(filters)}:page${page}:size${pageSize}`;
  const tags = [`user:${effectiveUserId}`, ...typesToFetch.map(type => `type:${type}`)];
  // Longer TTL for drawer operations (detected by small page size).
  const ttl = pageSize <= 5 ? cache.ttl.DRAWER : cache.ttl.DEFAULT;
  await cache.set(cacheKey, JSON.stringify(response), ttl, tags);

  return response;
}

// ---------------------------------------------------------------------------
// Grouped view (server-side group-by for the unified list)
// ---------------------------------------------------------------------------

export type ActivityGroupByKey = 'type' | 'priority' | 'status' | 'dueDate';

export interface ApiActivityGroup {
  /** Stable bucket key the client can localize (type/priority/dueDate) or show verbatim (status). */
  key: string;
  /** Human-readable English label; the client localizes known keys and falls back to this. */
  label: string;
  count: number;
  activities: Activity[];
}

export interface GroupedActivityResponse {
  groupBy: ActivityGroupByKey;
  groups: ApiActivityGroup[];
  totalCount: number;
  /** True when the result set exceeded the grouping cap and was truncated. */
  truncated: boolean;
}

// Grouping needs the full result set in memory; cap it so a pathological account (huge
// notification / time-entry history) can't blow up the response.
const GROUPED_ACTIVITY_CAP = 1000;

const TYPE_GROUP_ORDER: ActivityType[] = [
  ActivityType.TICKET,
  ActivityType.PROJECT_TASK,
  ActivityType.SCHEDULE,
  ActivityType.WORKFLOW_TASK,
  ActivityType.TIME_ENTRY,
  ActivityType.NOTIFICATION,
  ActivityType.DOCUMENT,
];

const TYPE_GROUP_LABELS: Record<string, string> = {
  [ActivityType.TICKET]: 'Tickets',
  [ActivityType.PROJECT_TASK]: 'Project tasks',
  [ActivityType.SCHEDULE]: 'Schedule',
  [ActivityType.WORKFLOW_TASK]: 'Workflow tasks',
  [ActivityType.TIME_ENTRY]: 'Time entries',
  [ActivityType.NOTIFICATION]: 'Notifications',
  [ActivityType.DOCUMENT]: 'Documents',
};

const DUE_DATE_GROUP_ORDER = ['overdue', 'today', 'thisWeek', 'later', 'none'] as const;
const DUE_DATE_GROUP_LABELS: Record<string, string> = {
  overdue: 'Overdue',
  today: 'Due today',
  thisWeek: 'Due this week',
  later: 'Later',
  none: 'No due date',
};

function startOfTodayMs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dueDateBucket(activity: Activity, todayStart: number): (typeof DUE_DATE_GROUP_ORDER)[number] {
  if (!activity.dueDate) return 'none';
  const due = new Date(activity.dueDate).getTime();
  if (Number.isNaN(due)) return 'none';
  const dayMs = 24 * 60 * 60 * 1000;
  if (due < todayStart) return 'overdue';
  if (due < todayStart + dayMs) return 'today';
  if (due < todayStart + 7 * dayMs) return 'thisWeek';
  return 'later';
}

/**
 * Bucket a fully-sorted activity list into ordered groups. Each group preserves the
 * incoming (sorted) order of its members. `type`, `priority`, and `dueDate` use fixed
 * orderings; `status` groups appear in first-seen order (i.e. honoring the active sort).
 */
function groupProcessedActivities(
  activities: Activity[],
  groupBy: ActivityGroupByKey
): ApiActivityGroup[] {
  const buckets = new Map<string, ApiActivityGroup>();
  const seenOrder: string[] = [];
  const todayStart = startOfTodayMs();

  const ensure = (key: string, label: string): ApiActivityGroup => {
    let group = buckets.get(key);
    if (!group) {
      group = { key, label, count: 0, activities: [] };
      buckets.set(key, group);
      seenOrder.push(key);
    }
    return group;
  };

  for (const activity of activities) {
    let key: string;
    let label: string;
    switch (groupBy) {
      case 'type':
        key = activity.type;
        label = TYPE_GROUP_LABELS[activity.type] ?? activity.type;
        break;
      case 'priority':
        // Group by the tenant's REAL priority name (e.g. "P1 Critical", "3"), not the
        // lossy normalized bucket — a tenant using 1–5 must not collapse into "Medium".
        key = activity.priorityName || 'none';
        label = activity.priorityName || 'No priority';
        break;
      case 'dueDate': {
        const bucket = dueDateBucket(activity, todayStart);
        key = bucket;
        label = DUE_DATE_GROUP_LABELS[bucket];
        break;
      }
      case 'status':
      default:
        key = activity.status || 'unknown';
        label = activity.status || 'Unknown';
        break;
    }
    const group = ensure(key, label);
    group.activities.push(activity);
    group.count += 1;
  }

  // Priority groups key on the real priority name, so order them by the normalized tier
  // (high→low, derived from each bucket's items) then by name (numeric-aware) — keeping
  // "Critical/High" on top and numeric schemes (1..5) in a natural order.
  if (groupBy === 'priority') {
    const tierOrder: Record<string, number> = {
      [ActivityPriority.HIGH]: 0,
      [ActivityPriority.MEDIUM]: 1,
      [ActivityPriority.LOW]: 2,
    };
    const tier = (group: ApiActivityGroup): number => {
      const sample = group.activities[0];
      return sample ? tierOrder[sample.priority] ?? 1 : 3;
    };
    return [...buckets.values()].sort((a, b) => {
      const t = tier(a) - tier(b);
      if (t !== 0) return t;
      return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  // Apply the fixed ordering for dimensions that have one; status keeps first-seen order.
  const fixedOrder: string[] | null =
    groupBy === 'type'
      ? (TYPE_GROUP_ORDER as string[])
      : groupBy === 'dueDate'
        ? [...DUE_DATE_GROUP_ORDER]
        : null;

  if (!fixedOrder) {
    return seenOrder.map((key) => buckets.get(key)!);
  }
  const rank = (key: string): number => {
    const i = fixedOrder.indexOf(key);
    return i === -1 ? fixedOrder.length : i;
  };
  return [...buckets.values()].sort((a, b) => rank(a.key) - rank(b.key));
}

/**
 * Grouped variant of {@link fetchUserActivitiesForApi}. Fetches and sorts the full
 * (filtered) activity set, then buckets it server-side by the requested dimension. The
 * set is capped at GROUPED_ACTIVITY_CAP; `truncated` reports when the cap was hit.
 */
export async function fetchUserActivitiesGroupedForApi(
  user: any,
  tenantId: string,
  filters: ActivityFilters = {},
  groupBy: ActivityGroupByKey
): Promise<GroupedActivityResponse> {
  const { activities } = await collectProcessedActivities(user, tenantId, filters);
  const totalCount = activities.length;
  const capped = activities.slice(0, GROUPED_ACTIVITY_CAP);
  const groups = groupProcessedActivities(capped, groupBy);
  return { groupBy, groups, totalCount, truncated: totalCount > capped.length };
}

/**
 * Fetch ad-hoc schedule entries assigned to a user, independent of any date window.
 *
 * The normal schedule fetch (getScheduleActivityEntries) filters on scheduled_start/end,
 * which excludes ad-hoc items that have no scheduled time. Ad-hoc items behave like
 * personal to-dos, so we surface them regardless of date. Done items (status='closed')
 * are still hidden by the caller's isClosed filter.
 */
async function fetchAdHocEntriesForUser(
  knex: Knex,
  tenant: string,
  userId: string
): Promise<any[]> {
  const scopedDb = tenantDb(knex, tenant);
  const rows = await scopedDb.tenantJoin(
    scopedDb.table('schedule_entries as se'),
    'schedule_entry_assignees as sea',
    'se.entry_id',
    'sea.entry_id'
  )
    .andWhere('se.work_item_type', 'ad_hoc')
    .andWhere('sea.user_id', userId)
    .whereNull('se.original_entry_id')
    .andWhere(function () {
      this.where('se.is_recurring', false).orWhereNull('se.is_recurring');
    })
    .select('se.*');

  if (rows.length === 0) return [];

  // Resolve the full assignee list for each entry
  const entryIds = rows.map((r: any) => r.entry_id);
  const assigneeRows = await scopedDb.table('schedule_entry_assignees')
    .whereIn('entry_id', entryIds)
    .select('entry_id', 'user_id');
  const assigneesByEntry = new Map<string, string[]>();
  for (const a of assigneeRows as Array<{ entry_id: string; user_id: string }>) {
    const list = assigneesByEntry.get(a.entry_id) || [];
    list.push(a.user_id);
    assigneesByEntry.set(a.entry_id, list);
  }

  return rows.map((r: any) => ({
    ...r,
    assigned_user_ids: assigneesByEntry.get(r.entry_id) || [userId],
  }));
}

/**
 * Fetch schedule activities for a user
 */
export async function fetchScheduleActivities(
  userId: string,
  tenantId: string,
  filters: ActivityFilters
): Promise<Activity[]> {
  try {
    // Determine date range for schedule entries
    const start = filters.dateRangeStart
      ? new Date(filters.dateRangeStart)
      : new Date();
    
    // Default to 30 days in the future if not specified
    const end = filters.dateRangeEnd
      ? new Date(filters.dateRangeEnd)
      : new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
    
    // Fetch schedule entries assigned to this user via the scheduling domain. This
    // owns ScheduleEntry model access (recurrence expansion + assignee filtering +
    // permission gate), so user-activities never imports the schedule model. Replaces
    // the former process-global scheduleEntryRegistry, which failed across Next bundles.
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error("Tenant is required");
    }
    let userEntries = await getScheduleActivityEntriesForUser(tenant, userId, start, end);

    // A timed opportunity step also has a schedule entry (work_item_type
    // 'opportunity_step'), but the feed already surfaces the step itself via
    // fetchOpportunityActivities — the canonical item, which carries the deal
    // context. Drop the schedule mirror here so the step doesn't appear twice.
    // Scoped to this feed fetcher on purpose: the schedule calendar and other
    // consumers of getScheduleActivityEntriesForUser still see these entries.
    userEntries = userEntries.filter(entry => entry.work_item_type !== 'opportunity_step');

    // Also include ad-hoc entries regardless of the date window — they may have no
    // scheduled time (which the window query above drops) or fall outside now→+30d.
    const adHocEntries = await fetchAdHocEntriesForUser(knex, tenant, userId);
    const existingEntryIds = new Set(userEntries.map(entry => entry.entry_id));
    for (const entry of adHocEntries) {
      if (!existingEntryIds.has(entry.entry_id)) {
        userEntries.push(entry);
      }
    }

    // Apply additional filters
    if (filters.isClosed === false) {
      userEntries = userEntries.filter(entry => entry.status !== 'closed');
    }
    
    if (filters.isRecurring !== undefined) {
      userEntries = userEntries.filter(entry => entry.is_recurring === filters.isRecurring);
    }
    
    if (filters.workItemType) {
      userEntries = userEntries.filter(entry => entry.work_item_type === filters.workItemType);
    }

    if (filters.clientId) {
      userEntries = await filterScheduleEntriesByClient(knex, tenant, userEntries, filters.clientId);
    }
    
    if (filters.search) {
      const searchTerm = filters.search.toLowerCase();
      userEntries = userEntries.filter(entry =>
        (entry.title && entry.title.toLowerCase().includes(searchTerm)) ||
        (entry.notes && entry.notes.toLowerCase().includes(searchTerm))
      );
    }
    
    // Convert to activities
    const activities = userEntries.map(entry => scheduleEntryToActivity(entry));

    // Apply priority filter post-mapping (schedule entries default to Medium priority)
    let filteredActivities = activities;
    if (filters.priority && filters.priority.length > 0) {
      const normalizedFilterPriorities = filters.priority.map(p => p.toLowerCase());
      filteredActivities = activities.filter((activity: Activity) =>
        normalizedFilterPriorities.includes(activity.priority.toLowerCase())
      );
    }

    // Cache individual activity type results
    if (filteredActivities.length > 0) {
      const cacheKey = `schedule-activities:${userId}:${JSON.stringify(filters)}`;
      await cache.set(cacheKey, JSON.stringify(filteredActivities), cache.ttl.LIST, [`user:${userId}`, `type:${ActivityType.SCHEDULE}`]);
    }

    return filteredActivities;
  } catch (error) {
    console.error("Error fetching schedule activities:", error);
    return [];
  }
}

/**
 * Fetch project task activities for a user
 */
/**
 * ISO-format a stored timestamp, or return null when it cannot be read.
 *
 * `new Date('nonsense').toISOString()` throws, and every fetcher here wraps its
 * whole body in a catch that returns []. Unguarded, a single unreadable date on
 * one row empties the entire section of the dashboard instead of dropping one
 * field. The ticket fetcher already guards this inline; this is the same rule.
 */
function toIsoOrNull(value: unknown): string | null {
  if (!value) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function fetchProjectActivities(
  userId: string,
  tenantId: string,
  filters: ActivityFilters,
  reader: IUserWithRoles
): Promise<Activity[]> {
  try {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Query for project tasks assigned to the user
    const tasks = await withTransaction(db, async (trx: Knex.Transaction) => {
      if (!await hasPermission(reader, 'project', 'read', trx)) return [];
      const scopedDb = tenantDb(trx, tenant);
      const projectTasksQuery = scopedDb.table("project_tasks")
        // Candidate selection contains only task/project identity; protected resource values
        // are loaded only after the project/read decision below.
        .select("project_tasks.task_id", "project_phases.project_id");

      scopedDb.tenantJoin(projectTasksQuery, "project_phases", "project_tasks.phase_id", "project_phases.phase_id", { type: "left" });
      const candidates = await projectTasksQuery
        .where(whereProjectTaskOnUsersList(scopedDb, db, userId));
      return loadAuthorizedProjectTaskActivities(trx, tenant, reader, candidates.map((candidate: any) => ({
        taskId: candidate.task_id,
        projectId: candidate.project_id,
      })));
    });

    // Convert authorized, masked projections to activities.
    const clientIdsByTask = new Map(tasks.map(({ task, clientId }: any) => [task.task_id, clientId]));
    const priorityIdsByTask = new Map(tasks.map(({ task }: any) => [task.task_id, task.priority_id]));
    const activities: ProjectTaskActivity[] = tasks.map(({ task, projectName, projectIsClosed, phaseName, statusName, isClosed, priorityName, priorityColor }: any): ProjectTaskActivity => {
      // Map priority from project task to ActivityPriority
      let priority: ActivityPriority;
      switch (priorityName?.toLowerCase()) {
        case 'high':
        case 'urgent':
        case 'critical':
          priority = ActivityPriority.HIGH;
          break;
        case 'low':
        case 'minor':
          priority = ActivityPriority.LOW;
          break;
        default:
          priority = ActivityPriority.MEDIUM;
      }

      return {
        id: task.task_id,
        title: task.task_name,
        description: task.description || undefined,
        type: ActivityType.PROJECT_TASK,
        status: statusName || 'To Do', // Use the status name from standard_statuses
        statusColor: task.status_color || '#3b82f6', // Use the blue color for consistency
        // A task is effectively closed when its own status is closed OR its project is closed.
        isClosed: Boolean(isClosed) || Boolean(projectIsClosed),
        priority,
        priorityName: priorityName || undefined,
        priorityColor: priorityColor || undefined,
        dueDate: toIsoOrNull(task.due_date) ?? undefined,
        assignedTo: task.assigned_to ? [task.assigned_to] : [],
        sourceId: task.task_id,
        sourceType: ActivityType.PROJECT_TASK,
        projectId: task.project_id || task.phase_id,
        phaseId: task.phase_id,
        projectName,
        phaseName,
        statusMappingId: task.project_status_mapping_id,
        estimatedHours: task.estimated_hours || undefined,
        actualHours: task.actual_hours || undefined,
        wbsCode: task.wbs_code,
        actions: [
          { id: 'view', label: 'View Details' },
          { id: 'edit', label: 'Edit' }
        ],
        tenant: task.tenant,
        createdAt: toIsoOrNull(task.created_at) ?? new Date().toISOString(),
        updatedAt: toIsoOrNull(task.updated_at) ?? new Date().toISOString()
      };
    });

    // Authorization and projection precede all activity filters so denied rows never
    // affect result membership, counts, or pagination.
    let filteredActivities = activities.filter((activity) => {
      const activityDate = activity.dueDate ? activity.dueDate.slice(0, 10) : null;
      if (filters.dueDateStart && (!activityDate || activityDate < toPlainDate(filters.dueDateStart))) return false;
      if (filters.dueDateEnd && (!activityDate || activityDate > toPlainDate(filters.dueDateEnd))) return false;
      if (filters.createdAtStart && (!activity.createdAt || activity.createdAt < filters.createdAtStart)) return false;
      if (filters.createdAtEnd && (!activity.createdAt || activity.createdAt > filters.createdAtEnd)) return false;
      if (filters.isClosed === false && activity.isClosed) return false;
      if (filters.clientId && clientIdsByTask.get(activity.id) !== filters.clientId) return false;
      const hasProjectIds = Boolean(filters.projectIds?.length);
      const hasPhaseIds = Boolean(filters.phaseIds?.length);
      if (hasProjectIds || hasPhaseIds) {
        const projectIds = filters.projectIds ?? [];
        const phaseIds = filters.phaseIds ?? [];
        if (!(hasProjectIds && projectIds.includes(activity.projectId ?? '') || hasPhaseIds && phaseIds.includes(activity.phaseId ?? ''))) return false;
      } else if (filters.projectId && activity.projectId !== filters.projectId) return false;
      if (filters.phaseId && activity.phaseId !== filters.phaseId) return false;
      if (filters.status?.length && !filters.status.includes(activity.status)) return false;
      if (filters.projectStatusMappingIds?.length && !filters.projectStatusMappingIds.includes(activity.statusMappingId ?? '')) return false;
      if (filters.excludeProjectStatusMappingIds?.length && filters.excludeProjectStatusMappingIds.includes(activity.statusMappingId ?? '')) return false;
      if (filters.excludeProjectIds?.length && filters.excludeProjectIds.includes(activity.projectId ?? '')) return false;
      if (filters.excludePhaseIds?.length && filters.excludePhaseIds.includes(activity.phaseId ?? '')) return false;
      if (filters.priorityIds?.length && !filters.priorityIds.includes(priorityIdsByTask.get(activity.id) ?? '')) return false;
      if (filters.search) {
        const search = filters.search.toLocaleLowerCase();
        if (!`${activity.title ?? ''} ${activity.description ?? ''}`.toLocaleLowerCase().includes(search)) return false;
      }
      return true;
    });

    if (filters.projectTaskTagIds?.length && filteredActivities.length) {
      const { knex: tagDb } = await createTenantKnex(tenantId);
      const scopedTagDb = tenantDb(tagDb, tenant);
      const mappings = await scopedTagDb.table('tag_mappings')
        .where({ tagged_type: 'project_task' })
        .whereIn('tagged_id', filteredActivities.map(({ id }) => id))
        .whereIn('tag_id', filters.projectTaskTagIds)
        .select('tagged_id');
      const tagged = new Set(mappings.map(({ tagged_id }: any) => tagged_id));
      filteredActivities = filteredActivities.filter(({ id }) => tagged.has(id));
    }

    // Priority tier is derived from the projected priority name, defaulting to Medium.
    if (filters.priority && filters.priority.length > 0) {
      const normalizedFilterPriorities = filters.priority.map(p => p.toLowerCase());
      filteredActivities = activities.filter((activity: Activity) =>
        normalizedFilterPriorities.includes(activity.priority.toLowerCase())
      );
    }

    // Cache individual activity type results
    if (filteredActivities.length > 0) {
      const cacheKey = `project-activities:${userId}:${JSON.stringify(filters)}`;
      await cache.set(cacheKey, JSON.stringify(filteredActivities), cache.ttl.LIST, [`user:${userId}`, `type:${ActivityType.PROJECT_TASK}`]);
    }

    return filteredActivities;
  } catch (error) {
    console.error("Error fetching project activities:", error);
    return [];
  }
}

/**
 * Fetch ticket activities for a user
 */
export async function fetchTicketActivities(
  userId: string,
  tenantId: string,
  filters: ActivityFilters
): Promise<Activity[]> {
  try {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Query for tickets assigned to the user
    const tickets = await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      const ticketsQuery = scopedDb.table("tickets")
        .select(
          "tickets.*",
          "clients.client_name",
          "contacts.full_name as contact_name",
          "statuses.name as status_name",
          "statuses.is_closed",
          "priorities.priority_name",
          "priorities.color as priority_color"
        );

      scopedDb.tenantJoin(ticketsQuery, "clients", "tickets.client_id", "clients.client_id", { type: "left" });
      scopedDb.tenantJoin(ticketsQuery, "contacts", "tickets.contact_name_id", "contacts.contact_name_id", { type: "left" });
      scopedDb.tenantJoin(ticketsQuery, "statuses", "tickets.status_id", "statuses.status_id", { type: "left" });
      scopedDb.tenantJoin(ticketsQuery, "priorities", "tickets.priority_id", "priorities.priority_id", { type: "left" });

      return await ticketsQuery
        .where(whereTicketOnUsersList(scopedDb, db, userId))
      // Apply filters
      .modify(function(queryBuilder) {
        if (filters.status && filters.status.length > 0) {
          queryBuilder.whereIn("tickets.status_id", filters.status);
        }

        // Ticket-specific board filter
        if (filters.ticketBoardIds && filters.ticketBoardIds.length > 0) {
          queryBuilder.whereIn("tickets.board_id", filters.ticketBoardIds);
        }
        if (filters.ticketExcludeBoardIds && filters.ticketExcludeBoardIds.length > 0) {
          queryBuilder.whereNotIn("tickets.board_id", filters.ticketExcludeBoardIds);
        }

        // Ticket-specific status filter by status_id
        if (filters.ticketStatusIds && filters.ticketStatusIds.length > 0) {
          queryBuilder.whereIn("tickets.status_id", filters.ticketStatusIds);
        }
        if (filters.ticketExcludeStatusIds && filters.ticketExcludeStatusIds.length > 0) {
          queryBuilder.whereNotIn("tickets.status_id", filters.ticketExcludeStatusIds);
        }

        // Apply priority filter by priority IDs if provided
        if (filters.priorityIds && filters.priorityIds.length > 0) {
          queryBuilder.whereIn("tickets.priority_id", filters.priorityIds);
        }

        // Due date filter (existing)
        if (filters.dueDateStart) {
          queryBuilder.where("tickets.due_date", ">=", toPlainDate(filters.dueDateStart));
        }
        if (filters.dueDateEnd) {
          queryBuilder.where("tickets.due_date", "<=", toPlainDate(filters.dueDateEnd));
        }

        // Created-date ("date entered") filter. Tickets record their creation time in
        // `entered_at` (there is no `created_at` column). It is a full timestamp, so compare
        // against the raw ISO bounds (the UI snaps `end` to 23:59:59.999 of the chosen day).
        if (filters.createdAtStart) {
          queryBuilder.where("tickets.entered_at", ">=", filters.createdAtStart);
        }
        if (filters.createdAtEnd) {
          queryBuilder.where("tickets.entered_at", "<=", filters.createdAtEnd);
        }

        // Closed filter
        if (filters.isClosed === false) {
          // If isClosed is false, only show open tickets
          queryBuilder.where("statuses.is_closed", false);
        }
        // If isClosed is true, show all tickets (both open and closed)

        // Client filter
        if (filters.clientId) {
          queryBuilder.where("tickets.client_id", filters.clientId);
        }

        // Contact filter
        if (filters.contactId) {
          queryBuilder.where("tickets.contact_name_id", filters.contactId);
        }

        // Ticket number filter
        if (filters.ticketNumber) {
          queryBuilder.where("tickets.ticket_number", 'ilike', `%${filters.ticketNumber}%`);
        }

        // Tag filter: ticket must have at least one of the requested tags
        if (filters.ticketTagIds && filters.ticketTagIds.length > 0) {
          queryBuilder.whereExists(
            tenantDb(trx, tenant).table("tag_mappings")
              .select(db.raw(1))
              .whereRaw("tag_mappings.tagged_id = tickets.ticket_id::text")
              .andWhere("tag_mappings.tagged_type", "ticket")
              .whereIn("tag_mappings.tag_id", filters.ticketTagIds!)
          );
        }

        // Text search filter
        if (filters.search) {
          const searchTerm = `%${filters.search}%`;
          queryBuilder.where(function() {
            this.where("tickets.title", 'ilike', searchTerm)
              .orWhere("tickets.ticket_number", 'ilike', searchTerm);
          });
        }
      });
    });

    // Convert to activities
    const activities = tickets.map((ticket: any) => {
      // Map priority from ticket to ActivityPriority
      let priority: ActivityPriority;
      switch (ticket.priority_name?.toLowerCase()) {
        case 'high':
        case 'urgent':
        case 'critical':
          priority = ActivityPriority.HIGH;
          break;
        case 'low':
        case 'minor':
          priority = ActivityPriority.LOW;
          break;
        default:
          priority = ActivityPriority.MEDIUM;
      }

      return {
        id: ticket.ticket_id,
        title: ticket.title,
        description: ticket.description,
        type: ActivityType.TICKET,
        status: ticket.status_name || 'Unknown',
        priority,
        priorityName: ticket.priority_name || undefined,
        priorityColor: ticket.priority_color || undefined,
        dueDate: ticket.due_date ? (new Date(ticket.due_date).toString() !== 'Invalid Date' ? new Date(ticket.due_date).toISOString() : undefined) : undefined,
        assignedTo: ticket.assigned_to ? [ticket.assigned_to] : [],
        sourceId: ticket.ticket_id,
        sourceType: ActivityType.TICKET,
        ticketNumber: ticket.ticket_number,
        boardId: ticket.board_id,
        statusId: ticket.status_id,
        clientId: ticket.client_id,
        clientName: ticket.client_name,
        contactId: ticket.contact_name_id,
        contactName: ticket.contact_name,
        estimatedHours: ticket.estimated_hours,
        isClosed: ticket.is_closed,
        actions: [
          { id: 'view', label: 'View Details' },
          { id: 'edit', label: 'Edit' }
        ],
        tenant: ticket.tenant,
        // Tickets store their creation time in `entered_at` (no `created_at` column). Reading
        // the wrong field silently fell back to "now", which broke created-date filtering/sort.
        createdAt: ticket.entered_at ? (new Date(ticket.entered_at).toString() !== 'Invalid Date' ? new Date(ticket.entered_at).toISOString() : new Date().toISOString()) as ISO8601String : new Date().toISOString() as ISO8601String,
        updatedAt: ticket.updated_at ? (new Date(ticket.updated_at).toString() !== 'Invalid Date' ? new Date(ticket.updated_at).toISOString() : new Date().toISOString()) as ISO8601String : new Date().toISOString() as ISO8601String
      };
    });

    // Apply priority filter post-mapping (priority is derived from priority_name, defaulting to Medium)
    let filteredActivities = activities;
    if (filters.priority && filters.priority.length > 0) {
      const normalizedFilterPriorities = filters.priority.map(p => p.toLowerCase());
      filteredActivities = activities.filter((activity: Activity) =>
        normalizedFilterPriorities.includes(activity.priority.toLowerCase())
      );
    }

    // Cache individual activity type results
    if (filteredActivities.length > 0) {
      const cacheKey = `ticket-activities:${userId}:${JSON.stringify(filters)}`;
      await cache.set(cacheKey, JSON.stringify(filteredActivities), cache.ttl.LIST, [`user:${userId}`, `type:${ActivityType.TICKET}`]);
    }

    return filteredActivities;
  } catch (error) {
    console.error("Error fetching ticket activities:", error);
    return [];
  }
}

/**
 * Fetch time entry activities for a user
 */
export async function fetchTimeEntryActivities(
  userId: string,
  tenantId: string,
  filters: ActivityFilters
): Promise<Activity[]> {
  try {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Query for time entries created by the user
    const timeEntries = await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      return await scopedDb.table("time_entries")
        .where("time_entries.user_id", userId)
        // Apply date range filter if provided
        .modify(function(queryBuilder) {
          if (filters.dateRangeStart) {
            queryBuilder.where("time_entries.start_time", ">=", filters.dateRangeStart);
          }

          if (filters.dateRangeEnd) {
            queryBuilder.where("time_entries.end_time", "<=", filters.dateRangeEnd);
          }

          // Apply status filter if provided
          if (filters.status && filters.status.length > 0) {
            queryBuilder.whereIn("time_entries.approval_status", filters.status);
          }

          if (filters.clientId) {
            queryBuilder.where(function() {
              this.where(function() {
                this.where("time_entries.work_item_type", "ticket")
                  .whereExists(
                    scopedDb.table("tickets")
                      .select(db.raw(1))
                      .whereRaw("tickets.ticket_id = time_entries.work_item_id")
                      .andWhere("tickets.client_id", filters.clientId)
                  );
              }).orWhere(function() {
                this.where("time_entries.work_item_type", "project_task")
                  .whereExists(
                    scopedDb.table("project_tasks")
                      .select(db.raw(1))
                      .modify((projectTaskQuery) => {
                        scopedDb.tenantJoin(
                          projectTaskQuery,
                          "project_phases",
                          "project_tasks.phase_id",
                          "project_phases.phase_id"
                        );
                        scopedDb.tenantJoin(
                          projectTaskQuery,
                          "projects",
                          "project_phases.project_id",
                          "projects.project_id"
                        );
                      })
                      .whereRaw("project_tasks.task_id = time_entries.work_item_id")
                      .andWhere("projects.client_id", filters.clientId)
                  );
              });
            });
          }
        });
    });

    // Convert to activities
    const activities = timeEntries.map((entry: any) => timeEntryToActivity(entry));

    // Apply priority filter post-mapping (time entries default to Medium priority)
    let filteredActivities = activities;
    if (filters.priority && filters.priority.length > 0) {
      const normalizedFilterPriorities = filters.priority.map(p => p.toLowerCase());
      filteredActivities = activities.filter((activity: Activity) =>
        normalizedFilterPriorities.includes(activity.priority.toLowerCase())
      );
    }

    // Cache individual activity type results
    if (filteredActivities.length > 0) {
      const cacheKey = `time-entry-activities:${userId}:${JSON.stringify(filters)}`;
      await cache.set(cacheKey, JSON.stringify(filteredActivities), cache.ttl.LIST, [`user:${userId}`, `type:${ActivityType.TIME_ENTRY}`]);
    }

    return filteredActivities;
  } catch (error) {
    console.error("Error fetching time entry activities:", error);
    return [];
  }
}


/**
 * Process activities by applying additional filtering, sorting, etc.
 */
export function processActivities(
  activities: Activity[],
  filters: ActivityFilters
): Activity[] {
  // Apply all filters
  let filteredActivities = activities;
  
  // Apply search filter if provided
  if (filters.search) {
    const searchLower = filters.search.toLowerCase();
    filteredActivities = filteredActivities.filter(activity => 
      activity.title.toLowerCase().includes(searchLower) ||
      (activity.description && activity.description.toLowerCase().includes(searchLower))
    );
  }
  
  // Apply status filter if provided
  if (filters.status && filters.status.length > 0) {
    filteredActivities = filteredActivities.filter(activity => 
      filters.status!.includes(activity.status)
    );
  }
  
  // Apply priority filter if provided
  if (filters.priority && filters.priority.length > 0) {
    // Normalize to lowercase for case-insensitive comparison
    const normalizedFilterPriorities = filters.priority.map(p => p.toLowerCase());
    filteredActivities = filteredActivities.filter(activity =>
      normalizedFilterPriorities.includes(activity.priority.toLowerCase())
    );
  }
  
  // Apply due date range filter if provided
  if (filters.dueDateStart || filters.dueDateEnd) {
    filteredActivities = filteredActivities.filter(activity => {
      if (!activity.dueDate) return false;
      
      const dueDate = new Date(activity.dueDate).getTime();
      
      if (filters.dueDateStart) {
        const startDate = new Date(filters.dueDateStart).getTime();
        if (dueDate < startDate) return false;
      }
      
      if (filters.dueDateEnd) {
        const endDate = new Date(filters.dueDateEnd).getTime();
        if (dueDate > endDate) return false;
      }
      
      return true;
    });
  }
  
  // Apply created-date ("date entered") range filter if provided. createdAt is present on
  // every activity type, so this covers the types not filtered at the SQL level above
  // (schedule, workflow tasks, time entries, notifications, ad-hoc, documents).
  if (filters.createdAtStart || filters.createdAtEnd) {
    filteredActivities = filteredActivities.filter(activity => {
      if (!activity.createdAt) return false;

      const createdAt = new Date(activity.createdAt).getTime();

      if (filters.createdAtStart) {
        const startDate = new Date(filters.createdAtStart).getTime();
        if (createdAt < startDate) return false;
      }

      if (filters.createdAtEnd) {
        const endDate = new Date(filters.createdAtEnd).getTime();
        if (createdAt > endDate) return false;
      }

      return true;
    });
  }

  // Apply assigned to filter if provided
  if (filters.assignedTo && filters.assignedTo.length > 0) {
    filteredActivities = filteredActivities.filter(activity => {
      if (!activity.assignedTo || activity.assignedTo.length === 0) return false;
      
      return activity.assignedTo.some(userId => 
        filters.assignedTo!.includes(userId)
      );
    });
  }

  // Apply sorting
  sortActivities(filteredActivities, filters.sortBy, filters.sortDirection);

  // Collapse recurring series AFTER sorting (the fetcher's occurrence order is not guaranteed,
  // so the survivor is the first in sort order, i.e. the earliest due under the default sort)
  // and BEFORE pagination (the caller slices afterwards) so counts are per series.
  if (filters.collapseRecurringSeries) {
    filteredActivities = collapseRecurringSeries(filteredActivities);
  }

  return filteredActivities;
}

/**
 * Sort activities in place based on requested column and direction.
 * Rules:
 * - When sortBy is not specified, applies the default sort (priority high→low, then due date asc).
 * - For `priority` and `dueDate`: items with no value always go to the bottom, regardless of direction.
 * - For text columns: case-insensitive locale comparison.
 */
function sortActivities(
  activities: Activity[],
  sortBy?: import('@alga-psa/types').ActivitySortBy,
  sortDirection: 'asc' | 'desc' = 'asc'
): void {
  if (!sortBy) {
    // Default sort: priority (high first) then due date (closest first) then newest created
    const priorityOrder = {
      [ActivityPriority.HIGH]: 0,
      [ActivityPriority.MEDIUM]: 1,
      [ActivityPriority.LOW]: 2,
    };
    activities.sort((a, b) => {
      const pd = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pd !== 0) return pd;
      if (a.dueDate && b.dueDate) {
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      } else if (a.dueDate) {
        return -1;
      } else if (b.dueDate) {
        return 1;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return;
  }

  const dir = sortDirection === 'desc' ? -1 : 1;

  const compareStrings = (a: string, b: string): number =>
    a.localeCompare(b, undefined, { sensitivity: 'base' });

  activities.sort((a, b) => {
    switch (sortBy) {
      case 'type':
        return compareStrings(a.type, b.type) * dir;

      case 'title':
        return compareStrings(a.title || '', b.title || '') * dir;

      case 'status':
        return compareStrings(a.status || '', b.status || '') * dir;

      case 'priority': {
        // "None" (no priorityName) always at bottom regardless of direction
        const aNone = !a.priorityName;
        const bNone = !b.priorityName;
        if (aNone && bNone) return 0;
        if (aNone) return 1;
        if (bNone) return -1;
        return compareStrings(a.priorityName!, b.priorityName!) * dir;
      }

      case 'dueDate': {
        // No due date always at bottom regardless of direction
        const aHas = !!a.dueDate;
        const bHas = !!b.dueDate;
        if (!aHas && !bHas) return 0;
        if (!aHas) return 1;
        if (!bHas) return -1;
        return (new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime()) * dir;
      }

      default:
        return 0;
    }
  });
}

/**
 * Fetch notification activities
 */
function applyNotificationActivityFilters(
  queryBuilder: Knex.QueryBuilder,
  filters: ActivityFilters
): void {
  if (filters.isClosed === false) {
    queryBuilder.where('internal_notifications.is_read', false);
  } else if (filters.isClosed === true) {
    queryBuilder.where('internal_notifications.is_read', true);
  }

  if (filters.search) {
    queryBuilder.where('internal_notifications.category', filters.search);
  }
  if (filters.dateRangeStart) {
    queryBuilder.where('internal_notifications.created_at', '>=', filters.dateRangeStart);
  }
  if (filters.dateRangeEnd) {
    queryBuilder.where('internal_notifications.created_at', '<=', filters.dateRangeEnd);
  }

  if (!filters.priority?.length) return;

  const storedPriorities = filters.priority.map((priority) =>
    priority === ActivityPriority.MEDIUM ? 'normal' : priority
  );
  queryBuilder.whereIn('internal_notifications.priority', storedPriorities);
}

function mapNotificationActivity(notification: any): NotificationActivity {
  const priority = mapStoredNotificationPriority(
    notification.priority,
    notification.type
  );
  const toIsoString = (value: unknown): string => {
    const parsed = value ? new Date(value as string | number | Date) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  };

  return {
    id: notification.internal_notification_id.toString(),
    title: notification.title,
    description: notification.message,
    type: ActivityType.NOTIFICATION,
    status: notification.type || 'info',
    priority,
    assignedTo: [notification.user_id],
    sourceId: notification.internal_notification_id.toString(),
    sourceType: ActivityType.NOTIFICATION,
    notificationId: notification.internal_notification_id,
    templateName: notification.template_name,
    message: notification.message,
    isRead: notification.is_read,
    readAt: notification.read_at,
    link: notification.link,
    metadata: notification.metadata,
    category: notification.category,
    actions: [
      { id: 'view', label: 'View Details' },
      { id: 'mark-read', label: notification.is_read ? 'Mark Unread' : 'Mark Read' }
    ],
    tenant: notification.tenant,
    createdAt: toIsoString(notification.created_at),
    updatedAt: toIsoString(notification.updated_at)
  };
}

function buildNotificationActivitiesQuery(
  trx: Knex.Transaction,
  tenant: string,
  userId: string,
  filters: ActivityFilters
): Knex.QueryBuilder {
  return tenantDb(trx, tenant).table('internal_notifications')
    .where('internal_notifications.user_id', userId)
    .whereNull('internal_notifications.deleted_at')
    .modify((queryBuilder) => {
      applyNotificationActivityFilters(queryBuilder, filters);
    });
}

/** Fetch notification activities for a user. */
export async function fetchNotificationActivities(
  userId: string,
  tenantId: string,
  filters: ActivityFilters
): Promise<Activity[]> {
  try {
    if (filters.clientId) return [];

    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) throw new Error('Tenant is required');

    const notifications = await withTransaction(db, async (trx: Knex.Transaction) =>
      buildNotificationActivitiesQuery(trx, tenant, userId, filters)
        .orderBy('internal_notifications.created_at', 'desc')
    );
    const activities = notifications.map((notification: any) =>
      mapNotificationActivity(notification)
    );

    if (activities.length > 0) {
      const cacheKey = `notification-activities:${userId}:${JSON.stringify(filters)}`;
      await cache.set(cacheKey, JSON.stringify(activities), cache.ttl.LIST, [`user:${userId}`, `type:${ActivityType.NOTIFICATION}`]);
    }
    return activities;
  } catch (error) {
    console.error('Error fetching notification activities:', error);
    return [];
  }
}

/**
 * Result of a single paged window of notification activities.
 */
export interface PagedNotificationActivities {
  activities: NotificationActivity[];
  /** Total number of notification activities matching the filters (before paging). */
  total: number;
}

/**
 * Paged variant of {@link fetchNotificationActivities} (task 29.8.46). The
 * database applies the shared filters, count, offset, and limit before rows are
 * mapped, so the focused view does not load the entire notification history.
 */
export async function fetchNotificationActivitiesPagedInternal(
  userId: string,
  tenantId: string,
  filters: ActivityFilters,
  offset: number = 0,
  limit: number = 20
): Promise<PagedNotificationActivities> {
  if (filters.clientId) return { activities: [], total: 0 };

  const { knex: db, tenant } = await createTenantKnex(tenantId);
  if (!tenant) throw new Error('Tenant is required');
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.max(0, Math.min(100, Math.floor(limit)));

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const baseQuery = buildNotificationActivitiesQuery(
      trx,
      tenant,
      userId,
      filters
    );
    const [{ count }] = await baseQuery.clone().count('* as count');
    const rows = await baseQuery.clone()
      .orderBy('internal_notifications.created_at', 'desc')
      .offset(safeOffset)
      .limit(safeLimit);

    return {
      activities: rows.map((row: any) => mapNotificationActivity(row)),
      total: Number(count),
    };
  });
}

/**
 * Fetch the open opportunity steps assigned to this user. Steps carry their own
 * assignee, so work handed to a colleague shows up in their feed rather than
 * only the deal owner's. Aggregation-only: the generic activities list renders
 * the base fields and follows `link`.
 */
export async function fetchOpportunityActivities(
  userId: string,
  tenantId: string,
  filters: ActivityFilters
): Promise<Activity[]> {
  try {
    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) throw new Error('Tenant is required');
    const db = tenantDb(knex, tenant);
    const query = db.table('opportunity_steps as s');
    db.tenantJoin(query, 'opportunities as o', 's.opportunity_id', 'o.opportunity_id');
    db.tenantJoin(query, 'clients as c', 'o.client_id', 'c.client_id');
    const scope = filters.opportunityScope ?? 'assigned';
    query
      .where('o.status', 'open')
      .where(function opportunityScopeClause() {
        // 'owned' answers "what is happening on my deals" even after a step is
        // handed to a colleague; 'assigned' stays the default personal queue.
        if (scope === 'owned') this.where('o.owner_id', userId);
        else if (scope === 'all') this.where('s.assigned_to', userId).orWhere('o.owner_id', userId);
        else this.where('s.assigned_to', userId);
      })
      .whereIn('s.status', ['current', 'planned'])
      .whereNotNull('s.due_at');

    if (filters.clientId) query.where('o.client_id', filters.clientId);
    if (filters.dueDateStart) query.where('s.due_at', '>=', filters.dueDateStart);
    if (filters.dueDateEnd) query.where('s.due_at', '<=', filters.dueDateEnd);
    if (filters.createdAtStart) query.where('s.created_at', '>=', filters.createdAtStart);
    if (filters.createdAtEnd) query.where('s.created_at', '<=', filters.createdAtEnd);
    if (filters.search) {
      const term = `%${filters.search}%`;
      query.where(function opportunitySearch() {
        this.whereILike('s.title', term)
          .orWhereILike('o.title', term)
          .orWhereILike('o.opportunity_number', term)
          .orWhereILike('c.client_name', term);
      });
    }

    const rows = await query.select(
      's.step_id',
      's.title as step_title',
      's.due_at',
      's.assigned_to',
      's.status as step_status',
      's.created_at',
      's.updated_at',
      'o.opportunity_id',
      'o.opportunity_number',
      'o.title as opportunity_title',
      'o.client_id',
      'c.client_name'
    );
    const now = Date.now();
    let activities: Activity[] = rows.map((row: any) => {
      const dueDate = new Date(row.due_at).toISOString();
      const overdue = row.step_status === 'current' && new Date(dueDate).getTime() < now;
      const link = `/msp/opportunities/${row.opportunity_id}`;
      return {
        id: row.step_id,
        title: row.step_title,
        description: `${row.client_name}: ${row.opportunity_title}`,
        type: ActivityType.SCHEDULE,
        status: overdue ? 'overdue' : row.step_status === 'current' ? 'open' : 'planned',
        priority: overdue ? ActivityPriority.HIGH : ActivityPriority.MEDIUM,
        dueDate,
        assignedTo: [row.assigned_to ?? userId],
        relatedEntities: [{
          id: row.opportunity_id,
          type: 'opportunity',
          name: row.opportunity_number,
          url: link,
        }],
        sourceId: row.step_id,
        sourceType: ActivityType.SCHEDULE,
        workItemId: row.step_id,
        workItemType: 'opportunity_step',
        link,
        actions: [{ id: 'view', label: 'Open Opportunity' }],
        isClosed: false,
        tenant,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      };
    });
    if (filters.status?.length) {
      activities = activities.filter((activity) => filters.status!.includes(activity.status));
    }
    if (filters.priority?.length) {
      activities = activities.filter((activity) => filters.priority!.includes(activity.priority));
    }
    return activities;
  } catch (error) {
    console.error('Error fetching opportunity activities:', error);
    return [];
  }
}

/**
 * Fetch awaiting-manual-publish social post targets as schedule activities
 * (marketing module F062). Surfaced next to opportunity next actions so the
 * manual publish queue shows up in the unified activities feed. Returns []
 * unless the `marketing-module` feature flag is on for the tenant AND the
 * caller holds marketing:manage; never throws.
 */
export async function fetchMarketingActivities(
  userId: string,
  tenantId: string,
  filters: ActivityFilters,
  user: any
): Promise<Activity[]> {
  try {
    const enabled = await isFeatureFlagEnabled('marketing-module', { tenantId, userId });
    if (!enabled) return [];

    const { knex, tenant } = await createTenantKnex(tenantId);
    if (!tenant) throw new Error('Tenant is required');

    // user is required: the permission check must never be skippable
    // (fail-open export).
    const allowed = await hasPermission(user, 'marketing', 'manage', knex);
    if (!allowed) return [];

    const db = tenantDb(knex, tenant);
    const query = db.table('social_post_targets as t')
      .join('social_posts as p', function joinPost() {
        this.on('p.tenant', '=', 't.tenant').andOn('p.post_id', '=', 't.post_id');
      })
      .join('marketing_content as c', function joinContent() {
        this.on('c.tenant', '=', 'p.tenant').andOn('c.content_id', '=', 'p.content_id');
      })
      .join('marketing_channels as ch', function joinChannel() {
        this.on('ch.tenant', '=', 't.tenant').andOn('ch.channel_id', '=', 't.channel_id');
      })
      .where({ 't.tenant': tenant, 't.status': 'awaiting-manual-publish' });

    if (filters.dueDateStart) query.where('p.scheduled_at', '>=', filters.dueDateStart);
    if (filters.dueDateEnd) query.where('p.scheduled_at', '<=', filters.dueDateEnd);
    if (filters.createdAtStart) query.where('t.created_at', '>=', filters.createdAtStart);
    if (filters.createdAtEnd) query.where('t.created_at', '<=', filters.createdAtEnd);
    if (filters.search) {
      const term = `%${filters.search}%`;
      query.where(function marketingSearch() {
        this.whereILike('c.title', term)
          .orWhereILike('ch.name', term);
      });
    }

    const rows = await query.select(
      't.target_id',
      't.post_id',
      'p.scheduled_at',
      'c.title as content_title',
      'ch.name as channel_name',
      't.created_at',
      't.updated_at'
    );
    const now = Date.now();
    const link = '/msp/marketing/posts';
    let activities: Activity[] = rows.map((row: any) => {
      const dueDate = row.scheduled_at ? new Date(row.scheduled_at).toISOString() : new Date(row.updated_at).toISOString();
      const overdue = new Date(dueDate).getTime() < now;
      return {
        id: row.target_id,
        title: `Publish to ${row.channel_name}`,
        description: row.content_title,
        type: ActivityType.SCHEDULE,
        status: overdue ? 'overdue' : 'open',
        priority: overdue ? ActivityPriority.HIGH : ActivityPriority.MEDIUM,
        dueDate,
        assignedTo: [userId],
        relatedEntities: [{
          id: row.post_id,
          type: 'marketing_post',
          name: row.content_title,
          url: link,
        }],
        sourceId: row.target_id,
        sourceType: ActivityType.SCHEDULE,
        workItemId: row.post_id,
        workItemType: 'marketing_post',
        link,
        actions: [{ id: 'view', label: 'View queue' }],
        isClosed: false,
        tenant,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      };
    });

    if (filters.status?.length) {
      activities = activities.filter((activity) => filters.status!.includes(activity.status));
    }
    if (filters.priority?.length) {
      activities = activities.filter((activity) => filters.priority!.includes(activity.priority));
    }
    return activities;
  } catch (error) {
    console.error('Error fetching marketing activities:', error);
    return [];
  }
}
