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
