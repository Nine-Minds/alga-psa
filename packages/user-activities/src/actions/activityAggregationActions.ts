// @ts-nocheck
// TODO: Argument count issues
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import {
  Activity,
  ActivityFilters,
  ActivityResponse,
  ActivityType,
  ActivityPriority,
  IWorkflowExecution,
  NotificationActivity,
  scheduleEntryToActivity,
  projectTaskToActivity,
  timeEntryToActivity,
  workflowTaskToActivity,
} from '@alga-psa/types';
// Identity-explicit core (NOT the withAuth `getScheduleActivityEntries`): the v1 REST API
// resolves the user from an API key, so withAuth — which reads the NextAuth session — would
// throw and the catch below would silently drop every schedule + ad-hoc item. The caller has
// already gated `targetUserId` via resolveActivityTarget.
import { getScheduleActivityEntriesForUser } from '@alga-psa/scheduling/actions/scheduleActivityCore';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { ISO8601String } from '@alga-psa/types';
import { IProjectTask } from '@alga-psa/types';

// Workflow tasks are the only EE-specific activity source. The base package resolves
// this to a CE stub (returns []); the EE app build aliases the specifier to the real
// implementation. This keeps `@alga-psa/user-activities` free of `@alga-psa/workflows`.
import { fetchWorkflowTaskActivities } from '@alga-psa/user-activities/server/workflow-tasks';
export { fetchWorkflowTaskActivities };

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
  const ticketIds = [
    ...new Set(
      entries
        .filter((entry) => entry.work_item_type === 'ticket' && entry.work_item_id)
        .map((entry) => entry.work_item_id)
    ),
  ];
  const projectTaskIds = [
    ...new Set(
      entries
        .filter((entry) => entry.work_item_type === 'project_task' && entry.work_item_id)
        .map((entry) => entry.work_item_id)
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
  }
  if (typesToFetch.includes(ActivityType.PROJECT_TASK)) {
    promises.push(fetchProjectActivities(effectiveUserId, tenantId, filters));
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
      filteredActivities = activities.filter(activity =>
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
export async function fetchProjectActivities(
  userId: string,
  tenantId: string,
  filters: ActivityFilters
): Promise<Activity[]> {
  try {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Query for project tasks assigned to the user
    const tasks = await withTransaction(db, async (trx: Knex.Transaction) => {
      const scopedDb = tenantDb(trx, tenant);
      const projectTasksQuery = scopedDb.table("project_tasks")
        .select(
          "project_tasks.*",
          "project_phases.phase_name",
          "project_phases.project_id",
          "projects.project_name",
          // Resolve status name and is_closed from either custom or standard status,
          // preferring psm.custom_name if provided.
          db.raw(
            "COALESCE(project_status_mappings.custom_name, custom_statuses.name, standard_statuses.name) as status_name"
          ),
          db.raw(
            "COALESCE(custom_statuses.is_closed, standard_statuses.is_closed, false) as is_closed"
          ),
          // Whether the parent PROJECT itself is closed (its status maps to a closed status).
          db.raw(
            "COALESCE(project_statuses.is_closed, false) as project_is_closed"
          ),
          "priorities.priority_name",
          "priorities.color as priority_color",
          db.raw("'#3b82f6' as status_color") // Blue color for consistency
        );

      scopedDb.tenantJoin(projectTasksQuery, "project_phases", "project_tasks.phase_id", "project_phases.phase_id", { type: "left" });
      scopedDb.tenantJoin(projectTasksQuery, "projects", "project_phases.project_id", "projects.project_id", { type: "left" });
      scopedDb.tenantJoin(projectTasksQuery, "statuses as project_statuses", "projects.status", "project_statuses.status_id", { type: "left" });
      scopedDb.tenantJoin(projectTasksQuery, "priorities", "project_tasks.priority_id", "priorities.priority_id", { type: "left" });
      scopedDb.tenantJoin(
        projectTasksQuery,
        "project_status_mappings",
        "project_tasks.project_status_mapping_id",
        "project_status_mappings.project_status_mapping_id",
        { type: "left" }
      );
      scopedDb.tenantJoin(
        projectTasksQuery,
        "standard_statuses",
        "project_status_mappings.standard_status_id",
        "standard_statuses.standard_status_id",
        { type: "left" }
      );
      scopedDb.tenantJoin(
        projectTasksQuery,
        "statuses as custom_statuses",
        "project_status_mappings.status_id",
        "custom_statuses.status_id",
        { type: "left" }
      );

      return await projectTasksQuery
        .where(function() {
          // Tasks directly assigned to the user
          this.where("project_tasks.assigned_to", userId);

          // Or tasks where the user is an additional resource
          this.orWhereExists(
            scopedDb.table("task_resources")
              .select(db.raw(1))
              .whereRaw("task_resources.task_id = project_tasks.task_id")
              .andWhere(function() {
                this.where("task_resources.assigned_to", userId)
                  .orWhere("task_resources.additional_user_id", userId);
              })
          );
        })
      // Apply filters
      .modify(function(queryBuilder) {
        // Apply status filter if provided
        if (filters.status && filters.status.length > 0) {
          const statusMappingIdsForNames = scopedDb.table("project_status_mappings")
            .select("project_status_mappings.project_status_mapping_id")
            .whereIn("standard_statuses.name", filters.status || []);
          scopedDb.tenantJoin(
            statusMappingIdsForNames,
            "standard_statuses",
            "project_status_mappings.standard_status_id",
            "standard_statuses.standard_status_id"
          );
          queryBuilder.whereIn(
            "project_tasks.project_status_mapping_id",
            statusMappingIdsForNames
          );
        }
        
        // Apply due date filter if provided
        if (filters.dueDateStart) {
          queryBuilder.where("project_tasks.due_date", ">=", toPlainDate(filters.dueDateStart));
        }
        
        if (filters.dueDateEnd) {
          queryBuilder.where("project_tasks.due_date", "<=", toPlainDate(filters.dueDateEnd));
        }
        
        // Apply closed filter if provided
        if (filters.isClosed === false) {
          // If isClosed is false, only show open tasks. A task is "closed" when
          // its mapping resolves to a status (custom OR standard) with is_closed=true.
          // Tasks with NULL project_status_mapping_id are treated as open.
          queryBuilder.where(function() {
            const openStatusMappingIds = scopedDb.table("project_status_mappings as psm")
              .select("psm.project_status_mapping_id")
              .whereRaw("COALESCE(cs.is_closed, ss.is_closed, false) = false");
            scopedDb.tenantJoin(openStatusMappingIds, "statuses as cs", "psm.status_id", "cs.status_id", { type: "left" });
            scopedDb.tenantJoin(
              openStatusMappingIds,
              "standard_statuses as ss",
              "psm.standard_status_id",
              "ss.standard_status_id",
              { type: "left" }
            );
            this.whereNull("project_tasks.project_status_mapping_id")
              .orWhereIn(
                "project_tasks.project_status_mapping_id",
                openStatusMappingIds
              );
          });

          // Also hide tasks whose parent PROJECT is closed. When the whole project is
          // done, its tasks shouldn't surface in the open activities view regardless of
          // each task's own status. Projects with a NULL/open status are treated as open.
          queryBuilder.whereRaw("COALESCE(project_statuses.is_closed, false) = false");
        }
        
        // Client filter
        if (filters.clientId) {
          queryBuilder.where("projects.client_id", filters.clientId);
        }

        // Apply project and phase filters with OR semantics:
        // A task matches if its project is selected OR its phase is selected.
        const hasProjectIds = filters.projectIds && filters.projectIds.length > 0;
        const hasPhaseIds = filters.phaseIds && filters.phaseIds.length > 0;

        if (hasProjectIds || hasPhaseIds) {
          queryBuilder.where(function() {
            if (hasProjectIds) {
              this.whereExists(
                tenantDb(trx, tenant).table("project_phases")
                  .select(db.raw(1))
                  .whereRaw("project_phases.phase_id = project_tasks.phase_id")
                  .whereIn("project_phases.project_id", filters.projectIds!)
              );
            }
            if (hasPhaseIds) {
              this.orWhereIn("project_tasks.phase_id", filters.phaseIds!);
            }
          });
        } else if (filters.projectId) {
          queryBuilder.whereExists(
            tenantDb(trx, tenant).table("project_phases")
              .select(db.raw(1))
              .whereRaw("project_phases.phase_id = project_tasks.phase_id")
              .andWhere("project_phases.project_id", filters.projectId)
          );
        }

        // Apply singular phase filter if provided (backward compat, combined with AND)
        if (filters.phaseId) {
          queryBuilder.where("project_tasks.phase_id", filters.phaseId);
        }
        
        // Project task-specific status filter by mapping ID
        if (filters.projectStatusMappingIds && filters.projectStatusMappingIds.length > 0) {
          queryBuilder.whereIn("project_tasks.project_status_mapping_id", filters.projectStatusMappingIds);
        }

        // Exclude tasks whose project is in the excluded set
        if (filters.excludeProjectIds && filters.excludeProjectIds.length > 0) {
          queryBuilder.whereNotExists(
            tenantDb(trx, tenant).table("project_phases")
              .select(db.raw(1))
              .whereRaw("project_phases.phase_id = project_tasks.phase_id")
              .whereIn("project_phases.project_id", filters.excludeProjectIds!)
          );
        }

        // Exclude tasks in the excluded phases
        if (filters.excludePhaseIds && filters.excludePhaseIds.length > 0) {
          queryBuilder.whereNotIn("project_tasks.phase_id", filters.excludePhaseIds);
        }

        // Exclude tasks in the excluded project statuses
        if (filters.excludeProjectStatusMappingIds && filters.excludeProjectStatusMappingIds.length > 0) {
          queryBuilder.whereNotIn("project_tasks.project_status_mapping_id", filters.excludeProjectStatusMappingIds);
        }

        // Apply priority filter by priority IDs if provided
        if (filters.priorityIds && filters.priorityIds.length > 0) {
          queryBuilder.whereIn("project_tasks.priority_id", filters.priorityIds);
        }

        // Tag filter: task must have at least one of the requested tags
        if (filters.projectTaskTagIds && filters.projectTaskTagIds.length > 0) {
          queryBuilder.whereExists(
            tenantDb(trx, tenant).table("tag_mappings")
              .select(db.raw(1))
              .whereRaw("tag_mappings.tagged_id = project_tasks.task_id::text")
              .andWhere("tag_mappings.tagged_type", "project_task")
              .whereIn("tag_mappings.tag_id", filters.projectTaskTagIds!)
          );
        }

        // Apply search filter if provided
        if (filters.search) {
          const searchTerm = `%${filters.search}%`;
          queryBuilder.where(function() {
            this.where("project_tasks.task_name", 'ilike', searchTerm)
              .orWhere("project_tasks.description", 'ilike', searchTerm);
          });
        }
      });
    });

    // Convert to activities
    const activities = tasks.map((task: any) => {
      // Map priority from project task to ActivityPriority
      let priority: ActivityPriority;
      switch (task.priority_name?.toLowerCase()) {
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
        status: task.status_name || 'To Do', // Use the status name from standard_statuses
        statusColor: task.status_color || '#3b82f6', // Use the blue color for consistency
        // A task is effectively closed when its own status is closed OR its project is closed.
        isClosed: Boolean(task.is_closed) || Boolean(task.project_is_closed),
        priority,
        priorityName: task.priority_name || undefined,
        priorityColor: task.priority_color || undefined,
        dueDate: task.due_date ? new Date(task.due_date).toISOString() : undefined,
        assignedTo: task.assigned_to ? [task.assigned_to] : [],
        sourceId: task.task_id,
        sourceType: ActivityType.PROJECT_TASK,
        projectId: task.project_id || task.phase_id,
        phaseId: task.phase_id,
        projectName: task.project_name,
        phaseName: task.phase_name,
        statusMappingId: task.project_status_mapping_id,
        estimatedHours: task.estimated_hours || undefined,
        actualHours: task.actual_hours || undefined,
        wbsCode: task.wbs_code,
        actions: [
          { id: 'view', label: 'View Details' },
          { id: 'edit', label: 'Edit' }
        ],
        tenant: task.tenant,
        createdAt: task.created_at ? new Date(task.created_at).toISOString() : new Date().toISOString(),
        updatedAt: task.updated_at ? new Date(task.updated_at).toISOString() : new Date().toISOString()
      };
    });

    // Apply priority filter post-mapping (priority is derived from priority_name, defaulting to Medium)
    let filteredActivities = activities;
    if (filters.priority && filters.priority.length > 0) {
      const normalizedFilterPriorities = filters.priority.map(p => p.toLowerCase());
      filteredActivities = activities.filter(activity =>
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
        .where(function() {
          // Tickets directly assigned to the user
          this.where("tickets.assigned_to", userId);

          // Or tickets where the user is an additional resource
          this.orWhereExists(
            scopedDb.table("ticket_resources")
              .select(db.raw(1))
              .whereRaw("ticket_resources.ticket_id = tickets.ticket_id")
              .andWhere(function() {
                this.where("ticket_resources.assigned_to", userId)
                  .orWhere("ticket_resources.additional_user_id", userId);
              })
          );
        })
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
        createdAt: ticket.created_at ? (new Date(ticket.created_at).toString() !== 'Invalid Date' ? new Date(ticket.created_at).toISOString() : new Date().toISOString()) as ISO8601String : new Date().toISOString() as ISO8601String,
        updatedAt: ticket.updated_at ? (new Date(ticket.updated_at).toString() !== 'Invalid Date' ? new Date(ticket.updated_at).toISOString() : new Date().toISOString()) as ISO8601String : new Date().toISOString() as ISO8601String
      };
    });

    // Apply priority filter post-mapping (priority is derived from priority_name, defaulting to Medium)
    let filteredActivities = activities;
    if (filters.priority && filters.priority.length > 0) {
      const normalizedFilterPriorities = filters.priority.map(p => p.toLowerCase());
      filteredActivities = activities.filter(activity =>
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
      filteredActivities = activities.filter(activity =>
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
function processActivities(
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
 * Fetch notification activities for a user
 */
export async function fetchNotificationActivities(
  userId: string,
  tenantId: string,
  filters: ActivityFilters
): Promise<Activity[]> {
  try {
    if (filters.clientId) {
      return [];
    }

    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error("Tenant is required");
    }

    // Query for notifications for the user
    const notifications = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await tenantDb(trx, tenant).table("internal_notifications")
        .where("internal_notifications.user_id", userId)
        .whereNull("internal_notifications.deleted_at")
        .modify(function(queryBuilder) {
          // Apply read/unread filter
          if (filters.isClosed === false) {
            // Show unread only (default)
            queryBuilder.where("internal_notifications.is_read", false);
          } else if (filters.isClosed === true) {
            // Show read only
            queryBuilder.where("internal_notifications.is_read", true);
          }
          // If isClosed is undefined, show all

          // Apply category filter (using search field as category)
          if (filters.search) {
            queryBuilder.where("internal_notifications.category", filters.search);
          }

          // Apply date range filter
          if (filters.dateRangeStart) {
            queryBuilder.where("internal_notifications.created_at", ">=", filters.dateRangeStart);
          }
          if (filters.dateRangeEnd) {
            queryBuilder.where("internal_notifications.created_at", "<=", filters.dateRangeEnd);
          }
        })
        .orderBy("internal_notifications.created_at", "desc");
    });

    // Convert to activities
    const activities: NotificationActivity[] = notifications.map((notification: any) => {
      // Map notification type to activity priority
      let priority: ActivityPriority;
      switch (notification.type) {
        case 'error':
          priority = ActivityPriority.HIGH;
          break;
        case 'warning':
          priority = ActivityPriority.MEDIUM;
          break;
        default:
          priority = ActivityPriority.LOW;
      }

      // Ensure dates are properly formatted
      let createdAtISO: string;
      let updatedAtISO: string;

      try {
        if (notification.created_at) {
          const createdDate = new Date(notification.created_at);
          if (isNaN(createdDate.getTime())) {
            console.warn('Invalid created_at date for notification:', notification.internal_notification_id, notification.created_at);
            createdAtISO = new Date().toISOString();
          } else {
            createdAtISO = createdDate.toISOString();
          }
        } else {
          createdAtISO = new Date().toISOString();
        }

        if (notification.updated_at) {
          const updatedDate = new Date(notification.updated_at);
          if (isNaN(updatedDate.getTime())) {
            console.warn('Invalid updated_at date for notification:', notification.internal_notification_id, notification.updated_at);
            updatedAtISO = new Date().toISOString();
          } else {
            updatedAtISO = updatedDate.toISOString();
          }
        } else {
          updatedAtISO = new Date().toISOString();
        }
      } catch (error) {
        console.error('Error parsing notification dates:', error, notification);
        createdAtISO = new Date().toISOString();
        updatedAtISO = new Date().toISOString();
      }

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
        createdAt: createdAtISO,
        updatedAt: updatedAtISO
      };
    });

    // Apply priority filter post-mapping (priority is derived from notification type)
    let filteredActivities: NotificationActivity[] = activities;
    if (filters.priority && filters.priority.length > 0) {
      const normalizedFilterPriorities = filters.priority.map(p => p.toLowerCase());
      filteredActivities = activities.filter(activity =>
        normalizedFilterPriorities.includes(activity.priority.toLowerCase())
      );
    }

    // Cache individual activity type results
    if (filteredActivities.length > 0) {
      const cacheKey = `notification-activities:${userId}:${JSON.stringify(filters)}`;
      await cache.set(cacheKey, JSON.stringify(filteredActivities), cache.ttl.LIST, [`user:${userId}`, `type:${ActivityType.NOTIFICATION}`]);
    }

    return filteredActivities;
  } catch (error) {
    console.error("Error fetching notification activities:", error);
    return [];
  }
}
