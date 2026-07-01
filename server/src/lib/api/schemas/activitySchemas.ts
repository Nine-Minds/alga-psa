/**
 * User Activities API Schemas
 * Validation schemas for the v1 `/activities` endpoints (unified read list + ad-hoc CRUD).
 *
 * Response shapes mirror the `Activity` model from `@alga-psa/types`
 * (`packages/types/src/interfaces/activity.interfaces.ts`).
 */

import { z } from 'zod';
import { ActivityType, ActivityPriority } from '@alga-psa/types';

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export const activityTypeSchema = z.nativeEnum(ActivityType);
export const activityPrioritySchema = z.nativeEnum(ActivityPriority);

const ACTIVITY_TYPE_VALUES = Object.values(ActivityType) as string[];
const ACTIVITY_PRIORITY_VALUES = Object.values(ActivityPriority) as string[];

/** Server-side sort columns (mirrors `ActivitySortBy` in @alga-psa/types). */
export const activitySortBySchema = z.enum(['type', 'title', 'status', 'priority', 'dueDate']);
export const activitySortDirectionSchema = z.enum(['asc', 'desc']);

/** Dimension the unified list is grouped by when `groupBy` is supplied. */
export const activityGroupBySchema = z.enum(['type', 'priority', 'status', 'dueDate']);
export type ActivityGroupBy = z.infer<typeof activityGroupBySchema>;

/**
 * Open/closed status filter for the unified list. Maps to the package's `isClosed` filter:
 *   - `open`   → isClosed = false (only active/open items)
 *   - `closed` → isClosed = true  (package surfaces everything; read-only items unfiltered)
 *   - `all`    → isClosed = undefined (no open/closed filtering)
 */
export const activityStatusFilterSchema = z.enum(['open', 'closed', 'all']);

// ---------------------------------------------------------------------------
// Request: GET /api/v1/activities (list)
// ---------------------------------------------------------------------------

// Normalize empty/whitespace-only query params to `undefined` so a cleared mobile filter
// (e.g. `?search=&status=`) is treated as "omitted" rather than rejected.
const emptyToUndefined = (val: unknown) =>
  typeof val === 'string' && val.trim() === '' ? undefined : val;

export const listActivitiesQuerySchema = z.object({
  // Comma-separated list of ActivityType values (e.g. "ticket,schedule").
  type: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .transform((val) =>
        val
          ? val
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined,
      )
      .refine(
        (types) => !types || types.every((t) => ACTIVITY_TYPE_VALUES.includes(t)),
        { message: `type must be a comma-separated list of: ${ACTIVITY_TYPE_VALUES.join(', ')}` },
      )
      .transform((types) => types as ActivityType[] | undefined),
  ),
  status: z.preprocess(emptyToUndefined, activityStatusFilterSchema.optional()),
  search: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .transform((val) => val?.trim() || undefined),
  ),
  // Schedule/time-entry/notification date window (ISO 8601).
  dateStart: z.preprocess(emptyToUndefined, z.string().datetime({ offset: true }).optional()),
  dateEnd: z.preprocess(emptyToUndefined, z.string().datetime({ offset: true }).optional()),
  // Comma-separated list of ActivityPriority values (e.g. "high,medium").
  priority: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .transform((val) =>
        val
          ? val
              .split(',')
              .map((p) => p.trim())
              .filter(Boolean)
          : undefined,
      )
      .refine(
        (priorities) => !priorities || priorities.every((p) => ACTIVITY_PRIORITY_VALUES.includes(p)),
        { message: `priority must be a comma-separated list of: ${ACTIVITY_PRIORITY_VALUES.join(', ')}` },
      )
      .transform((priorities) => priorities as ActivityPriority[] | undefined),
  ),
  // Comma-separated exact priority IDs (the tenant's real per-type priorities). Precise,
  // unlike the normalized `priority` bucket; applies to ticket/project-task activities.
  priorityIds: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .transform((val) =>
        val
          ? val
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
          : undefined,
      ),
  ),
  // Due-date window (ISO 8601), independent of the schedule date window above.
  dueDateStart: z.preprocess(emptyToUndefined, z.string().datetime({ offset: true }).optional()),
  dueDateEnd: z.preprocess(emptyToUndefined, z.string().datetime({ offset: true }).optional()),
  // Created-date ("date entered") window (ISO 8601), independent of the due-date and schedule windows.
  createdAtStart: z.preprocess(emptyToUndefined, z.string().datetime({ offset: true }).optional()),
  createdAtEnd: z.preprocess(emptyToUndefined, z.string().datetime({ offset: true }).optional()),
  sortBy: z.preprocess(emptyToUndefined, activitySortBySchema.optional()),
  sortDirection: z.preprocess(emptyToUndefined, activitySortDirectionSchema.optional()),
  // When present, the response is grouped by this dimension instead of paginated.
  groupBy: z.preprocess(emptyToUndefined, activityGroupBySchema.optional()),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export type ListActivitiesQuery = z.infer<typeof listActivitiesQuerySchema>;

// ---------------------------------------------------------------------------
// Request: ad-hoc CRUD bodies
// ---------------------------------------------------------------------------

const optionalIsoTimestamp = z.string().datetime({ offset: true }).nullable().optional();

export const createAdHocActivitySchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required'),
    notes: z.string().optional(),
    scheduledStart: optionalIsoTimestamp,
    scheduledEnd: optionalIsoTimestamp,
  })
  .refine(
    (data) =>
      !data.scheduledStart ||
      !data.scheduledEnd ||
      new Date(data.scheduledEnd) > new Date(data.scheduledStart),
    { message: 'End time must be after start time', path: ['scheduledEnd'] },
  );

export type CreateAdHocActivityBody = z.infer<typeof createAdHocActivitySchema>;

export const updateAdHocActivitySchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').optional(),
    // null clears the field; omit to leave unchanged.
    notes: z.string().nullable().optional(),
    scheduledStart: optionalIsoTimestamp,
    scheduledEnd: optionalIsoTimestamp,
  })
  .refine(
    (data) =>
      !data.scheduledStart ||
      !data.scheduledEnd ||
      new Date(data.scheduledEnd) > new Date(data.scheduledStart),
    { message: 'End time must be after start time', path: ['scheduledEnd'] },
  );

export type UpdateAdHocActivityBody = z.infer<typeof updateAdHocActivitySchema>;

export const setAdHocActivityDoneSchema = z.object({
  done: z.boolean(),
});

export type SetAdHocActivityDoneBody = z.infer<typeof setAdHocActivityDoneSchema>;

// ---------------------------------------------------------------------------
// Request: custom activity-group organization (drag-to-organize on mobile)
// ---------------------------------------------------------------------------

/** Body for POST /activities/groups/items — move an activity into a group at a position. */
export const moveActivityToGroupSchema = z.object({
  activityId: z.string().min(1, 'activityId is required'),
  activityType: z.string().min(1, 'activityType is required'),
  groupId: z.string().min(1, 'groupId is required'),
  sortOrder: z.number().int().min(0),
});

export type MoveActivityToGroupBody = z.infer<typeof moveActivityToGroupSchema>;

/** Body for DELETE /activities/groups/items — remove an activity from all of the caller's groups. */
export const removeActivityFromGroupSchema = z.object({
  activityId: z.string().min(1, 'activityId is required'),
  activityType: z.string().min(1, 'activityType is required'),
});

export type RemoveActivityFromGroupBody = z.infer<typeof removeActivityFromGroupSchema>;

/** Body for PATCH /activities/groups/{groupId}/items — persist the full ordered membership. */
export const reorderActivitiesInGroupSchema = z.object({
  items: z
    .array(
      z.object({
        activityId: z.string().min(1),
        activityType: z.string().min(1),
        sortOrder: z.number().int().min(0),
      }),
    )
    .min(1, 'items must not be empty'),
});

export type ReorderActivitiesInGroupBody = z.infer<typeof reorderActivitiesInGroupSchema>;

// ---------------------------------------------------------------------------
// Response shapes (mirror @alga-psa/types Activity)
// ---------------------------------------------------------------------------

const activityActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string().optional(),
  disabled: z.boolean().optional(),
  disabledReason: z.string().optional(),
});

/**
 * A single unified Activity. The base fields are explicit; type-specific fields
 * (ticketNumber, projectId, workItemType, …) pass through.
 */
export const activitySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    type: activityTypeSchema,
    status: z.string(),
    statusColor: z.string().optional(),
    priority: activityPrioritySchema,
    priorityName: z.string().optional(),
    priorityColor: z.string().optional(),
    dueDate: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    assignedTo: z.array(z.string()).optional(),
    assignedToNames: z.array(z.string()).optional(),
    sourceId: z.string(),
    sourceType: activityTypeSchema,
    actions: z.array(activityActionSchema),
    isClosed: z.boolean().optional(),
    tenant: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

export const activityListResponseSchema = z.object({
  data: z.array(activitySchema),
  pagination: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
    hasNext: z.boolean(),
    hasPrev: z.boolean(),
  }),
  meta: z.any().optional(),
});

/** Response for POST /activities/ad-hoc — the created ad-hoc rendered as a ScheduleActivity. */
export const adHocActivityResponseSchema = z.object({
  data: activitySchema,
  meta: z.any().optional(),
});

/** A single group bucket in the grouped activities response. */
export const activityGroupSchema = z.object({
  /** Stable bucket key the client can localize (type/priority/dueDate) or show verbatim (status). */
  key: z.string(),
  /** Human-readable English label; the client localizes known keys and falls back to this. */
  label: z.string(),
  count: z.number(),
  activities: z.array(activitySchema),
});

/** Response for GET /activities?groupBy=… — the unified list bucketed server-side. */
export const groupedActivitiesResponseSchema = z.object({
  data: z.object({
    groupBy: activityGroupBySchema,
    groups: z.array(activityGroupSchema),
    totalCount: z.number(),
    /** True when the result set exceeded the grouping cap and was truncated. */
    truncated: z.boolean(),
  }),
  meta: z.any().optional(),
});

/** One member reference inside a saved custom group. */
export const customActivityGroupItemSchema = z.object({
  itemId: z.string(),
  activityId: z.string(),
  activityType: z.string(),
  sortOrder: z.number(),
});

/** A user's saved custom activity group (created/ordered on the web) with its ordered items. */
export const customActivityGroupSchema = z.object({
  groupId: z.string(),
  groupName: z.string(),
  sortOrder: z.number(),
  isCollapsed: z.boolean(),
  items: z.array(customActivityGroupItemSchema),
});

/** Response for GET /activities/groups — the caller's saved custom groups (ordered). */
export const customActivityGroupsResponseSchema = z.object({
  data: z.array(customActivityGroupSchema),
  meta: z.any().optional(),
});
