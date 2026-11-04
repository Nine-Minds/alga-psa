/**
 * Time Sheet API Schemas
 * Validation schemas for time sheet-related API endpoints
 */

import { z } from 'zod';
import { TIME_SHEET_LIST_SORT_KEYS, TIME_SHEET_LIST_SORT_ALIASES, TIME_SHEET_LIST_DEFAULT_SORT } from './timeSheetSort';
import { Temporal } from '@js-temporal/polyfill';
import { 
  uuidSchema, 
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
  booleanTransform,
  dateSchema,
  isoDateSchema,
  paginationQuerySchema
} from './common';
import { approvalStatusSchema, timeEntryResponseSchema, workItemTypeSchema } from './timeEntry';

// Time period frequency schema
// Time periods are half-open [start_date, end_date).
const TIME_PERIOD_END_DATE_DESCRIPTION =
  'Exclusive end of the period: the first day after the period. A period covering Aug 16–22 has end_date 2026-08-23.';

// Time period dates are DATE columns: YYYY-MM-DD on the wire.
// Input also accepts an RFC 3339 datetime, truncated textually to the calendar date the client wrote.
export const timePeriodDateInputSchema = z
  .union([isoDateSchema, z.string().datetime({ offset: true })])
  .transform((value) => value.slice(0, 10))
  .refine((value) => {
    try {
      Temporal.PlainDate.from(value, { overflow: 'reject' });
      return true;
    } catch {
      return false;
    }
  }, 'Must be a valid calendar date');

export const timePeriodDateSchema = isoDateSchema;

export const timePeriodFrequencySchema = z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']);

// Create time sheet schema
export const createTimeSheetSchema = z.object({
  period_id: uuidSchema,
  user_id: uuidSchema.optional(), // Optional for creating for other users
  notes: z.string().optional()
});

// Update time sheet schema
export const updateTimeSheetSchema = z.object({
  notes: z.string().optional(),
  approval_status: approvalStatusSchema.optional()
});

// Time sheet filter schema
export const timeSheetFilterSchema = baseFilterSchema.extend({
  user_id: uuidSchema.optional(),
  period_id: uuidSchema.optional(),
  approval_status: approvalStatusSchema.optional(),
  submitted_from: z.string().datetime().optional(),
  submitted_to: z.string().datetime().optional(),
  approved_from: z.string().datetime().optional(),
  approved_to: z.string().datetime().optional(),
  approved_by: uuidSchema.optional(),
  has_entries: booleanTransform.optional(),
  period_start_from: dateSchema.optional(),
  period_start_to: dateSchema.optional(),
  period_end_from: dateSchema.optional(),
  period_end_to: dateSchema.optional()
});

// Time sheet list query schema
// `sort` is an allowlist (see TimeSheetService.resolveTimeSheetListSort); created_at is a legacy alias of period_start.
export const timeSheetListQuerySchema = createListQuerySchema(timeSheetFilterSchema).extend({
  sort: z.enum([...TIME_SHEET_LIST_SORT_KEYS, ...Object.keys(TIME_SHEET_LIST_SORT_ALIASES)] as [string, ...string[]])
    .optional()
    .default(TIME_SHEET_LIST_DEFAULT_SORT)
});

// Time sheet response schema
export const timeSheetResponseSchema = z.object({
  id: uuidSchema,
  period_id: uuidSchema,
  user_id: uuidSchema,
  approval_status: approvalStatusSchema,
  submitted_at: z.string().datetime().nullable(),
  approved_at: z.string().datetime().nullable(),
  approved_by: uuidSchema.nullable(),
  notes: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Computed/joined fields
  user_name: z.string().optional(),
  approver_name: z.string().optional(),
  total_hours: z.number().optional(),
  billable_hours: z.number().optional(),
  entry_count: z.number().optional()
});

// Time sheet with details response schema
export const timeSheetWithDetailsResponseSchema = timeSheetResponseSchema.extend({
  user: z.object({
    user_id: uuidSchema,
    first_name: z.string(),
    last_name: z.string(),
    email: z.string()
  }).optional(),
  
  approved_by_user: z.object({
    user_id: uuidSchema,
    first_name: z.string(),
    last_name: z.string(),
    email: z.string()
  }).optional(),
  
  time_period: z.object({
    period_id: uuidSchema,
    start_date: timePeriodDateSchema,
    end_date: timePeriodDateSchema.describe(TIME_PERIOD_END_DATE_DESCRIPTION),
    is_current: z.boolean(),
    is_closed: z.boolean()
  }).optional(),
  
  time_entries: z.array(timeEntryResponseSchema).optional(),
  
  comments: z.array(z.object({
    comment_id: uuidSchema,
    comment_text: z.string(),
    user_id: uuidSchema,
    user_name: z.string(),
    user_role: z.string(),
    created_at: z.string().datetime()
  })).optional(),
  
  summary: z.object({
    total_hours: z.number(),
    billable_hours: z.number(),
    non_billable_hours: z.number(),
    entries_by_type: z.record(z.string(), z.number()),
    entries_by_day: z.record(z.string(), z.number()),
    approval_ready: z.boolean()
  }).optional()
});

// Time period schemas
const timePeriodBodySchema = z.object({
  start_date: timePeriodDateInputSchema,
  end_date: timePeriodDateInputSchema.describe(TIME_PERIOD_END_DATE_DESCRIPTION),
  is_current: z.boolean().optional().describe('Ignored. is_current is derived from the dates on read; accepted for backward compatibility.')
});

const START_BEFORE_END_MESSAGE = 'Start date must be before end date';

export const createTimePeriodSchema = timePeriodBodySchema.refine(
  (data) => data.start_date < data.end_date,
  { message: START_BEFORE_END_MESSAGE, path: ['end_date'] }
);

export const updateTimePeriodSchema = createUpdateSchema(timePeriodBodySchema).superRefine((data, ctx) => {
  if (data.start_date !== undefined && data.end_date !== undefined && data.start_date >= data.end_date) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: START_BEFORE_END_MESSAGE, path: ['end_date'] });
  }
});

export const timePeriodResponseSchema = z.object({
  period_id: uuidSchema,
  start_date: timePeriodDateSchema,
  end_date: timePeriodDateSchema.describe(TIME_PERIOD_END_DATE_DESCRIPTION),
  is_current: z.boolean(),
  is_closed: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Computed fields
  duration_days: z.number().optional(),
  week_number: z.number().optional(),
  month_name: z.string().optional(),
  year: z.number().optional()
});

// Time period settings schemas
export const createTimePeriodSettingsSchema = z.object({
  frequency: timePeriodFrequencySchema,
  frequency_unit: z.number().min(1).optional().default(1),
  start_day: z.number().min(1).max(7).optional(), // 1=Monday, 7=Sunday
  end_day: z.number().min(1).max(7).optional(),
  start_month: z.number().min(1).max(12).optional(),
  end_month: z.number().min(1).max(12).optional(),
  effective_from: dateSchema,
  effective_to: dateSchema.optional(),
  is_active: z.boolean().optional().default(true)
});

export const updateTimePeriodSettingsSchema = createUpdateSchema(createTimePeriodSettingsSchema);

export const timePeriodSettingsResponseSchema = z.object({
  settings_id: uuidSchema,
  frequency: timePeriodFrequencySchema,
  frequency_unit: z.number(),
  start_day: z.number().nullable(),
  end_day: z.number().nullable(),
  start_month: z.number().nullable(),
  end_month: z.number().nullable(),
  effective_from: dateSchema,
  effective_to: dateSchema.nullable(),
  is_active: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema
});

// Time sheet comment schemas
export const createTimeSheetCommentSchema = z.object({
  comment_text: z.string().min(1, 'Comment text is required')
});

export const timeSheetCommentResponseSchema = z.object({
  comment_id: uuidSchema,
  time_sheet_id: uuidSchema,
  comment_text: z.string(),
  user_id: uuidSchema,
  user_role: z.string(),
  created_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // User details
  user: z.object({
    user_id: uuidSchema,
    first_name: z.string(),
    last_name: z.string(),
    email: z.string()
  }).optional()
});

// Time sheet approval operations
export const submitTimeSheetSchema = z.object({
  submission_notes: z.string().optional()
});

export const approveTimeSheetSchema = z.object({
  approval_notes: z.string().optional()
});

export const requestChangesTimeSheetSchema = z.object({
  change_reason: z.string().min(1, 'Change reason is required'),
  detailed_feedback: z.string().optional()
});

export const bulkApproveTimeSheetSchema = z.object({
  time_sheet_ids: z.array(uuidSchema).min(1).max(50),
  approval_notes: z.string().optional()
});

export const reverseApprovalSchema = z.object({
  reversal_reason: z.string().min(1, 'Reversal reason is required')
});

// Time sheet statistics
export const timeSheetStatsResponseSchema = z.object({
  total_time_sheets: z.number(),
  pending_approval: z.number(),
  approved_this_period: z.number(),
  changes_requested: z.number(),
  total_hours_this_period: z.number(),
  billable_hours_this_period: z.number(),
  time_sheets_by_status: z.record(z.string(), z.number()),
  time_sheets_by_user: z.record(z.string(), z.number()),
  average_hours_per_sheet: z.number(),
  approval_rate: z.number(),
  on_time_submission_rate: z.number(),
  top_users_by_hours: z.array(z.object({
    user_id: uuidSchema,
    user_name: z.string(),
    total_hours: z.number(),
    sheet_count: z.number()
  }))
});

// Query strings carry arrays as repeated params (?a=1&a=2) or comma-separated
// values (?a=1,2). The controller flattens searchParams to strings, so accept
// both a string and an array and normalise to string[] before validating.
const queryStringArray = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const parts = Array.isArray(value) ? value : [value];
    return parts
      .flatMap((part) => (typeof part === 'string' ? part.split(',') : [part]))
      .map((part) => (typeof part === 'string' ? part.trim() : part))
      .filter((part) => part !== '');
  }, z.array(item).optional());

// One row of GET /time-sheets/{id}/entries (and search include_entries): exactly the
// time_entries columns as TimeSheetService.getTimeSheetEntries serializes them to JSON.
// pg returns timestamptz as Date (ISO datetime) and integer as number; work_date (a DATE
// column) is formatted to YYYY-MM-DD by the service. There is no numeric column here.
export const timeSheetEntryRowSchema = z.object({
  tenant: uuidSchema,
  entry_id: uuidSchema,
  user_id: uuidSchema,
  start_time: z.string().datetime().nullable(),
  end_time: z.string().datetime(),
  notes: z.string().nullable(),
  work_item_id: uuidSchema.nullable(),
  billable_duration: z.number().int().nullable(),
  work_item_type: workItemTypeSchema.nullable(),
  // time_entries.approval_status is a DB enum that also allows REJECTED
  approval_status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED']).nullable(),
  time_sheet_id: uuidSchema.nullable(),
  created_at: z.string().datetime().nullable(),
  updated_at: z.string().datetime().nullable(),
  service_id: uuidSchema.nullable(),
  tax_region: z.string().nullable(),
  invoiced: z.boolean().nullable(),
  tax_rate_id: uuidSchema.nullable(),
  contract_line_id: uuidSchema.nullable(),
  work_date: isoDateSchema,
  work_timezone: z.string(),
  created_by: uuidSchema.nullable(),
  updated_by: uuidSchema.nullable(),
  contract_line_source: z
    .enum(['explicit', 'auto_unique_service', 'auto_bucket_overlay', 'unresolved', 'reconciled_at_generation', 'auto_billing_profile'])
    .nullable(),
  contract_line_unresolved_reason: z.enum(['ambiguous', 'no_match', 'error']).nullable(),
  catalog_pricing_acknowledged_at: z.string().datetime().nullable(),
  catalog_pricing_acknowledged_by: uuidSchema.nullable(),
  // NOT NULL DEFAULT 'commercial' (20261028135000); CHECK limits it to these values.
  billing_mode: z.enum(['commercial', 'operational']),
});

// One row of GET /time-sheets/search: exactly time_sheets.* plus the joined user_name.
// (time_sheets has no created_at/updated_at columns, so this is not timeSheetResponseSchema.)
export const timeSheetSearchRowSchema = z.object({
  tenant: uuidSchema,
  id: uuidSchema,
  user_id: uuidSchema,
  period_id: uuidSchema,
  approval_status: approvalStatusSchema,
  submitted_at: z.string().datetime().nullable(),
  approved_at: z.string().datetime().nullable(),
  approved_by: uuidSchema.nullable(),
  notes: z.string().nullable(),
  user_name: z.string(),
  time_entries: z.array(timeSheetEntryRowSchema).optional(),
});

// Time sheet search schema
export const timeSheetSearchSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  fields: queryStringArray(z.enum(['user_name'])),
  approval_statuses: queryStringArray(approvalStatusSchema),
  user_ids: queryStringArray(uuidSchema),
  period_ids: queryStringArray(uuidSchema),
  // YYYY-MM-DD, compared against time_periods.start_date / end_date
  date_from: isoDateSchema.optional(),
  date_to: isoDateSchema.optional(),
  include_entries: booleanTransform.prefault("false"),
  limit: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(100)).prefault('25')
});

// Time sheet summary response (GET /time-sheets/{id}/summary)
export const timeSheetSummaryResponseSchema = z.object({
  total_hours: z.number(),
  billable_hours: z.number(),
  non_billable_hours: z.number(),
  entries_by_type: z.record(z.string(), z.number()),
  entries_by_day: z.record(z.string(), z.number()),
  approval_ready: z.boolean()
});

// Time sheet export schema
export const timeSheetExportQuerySchema = z.object({
  format: z.enum(['csv', 'json', 'xlsx']).optional().default('csv'),
  include_time_entries: booleanTransform.prefault("false"),
  include_comments: booleanTransform.prefault("false"),
  group_by: z.enum(['user', 'period', 'status', 'none']).optional().default('none'),
  approval_statuses: z.array(approvalStatusSchema).optional(),
  user_ids: z.array(uuidSchema).optional(),
  period_ids: z.array(uuidSchema).optional(),
  date_from: dateSchema.optional(),
  date_to: dateSchema.optional(),
  fields: z.array(z.string()).optional()
});

// Base schedule entry schema (without refinements)
const baseScheduleEntrySchema = z.object({
  title: z.string().min(1, 'Title is required'),
  scheduled_start: z.string().datetime(),
  scheduled_end: z.string().datetime(),
  work_item_id: uuidSchema.optional(),
  work_item_type: z.enum(['ticket', 'project_task', 'meeting', 'break', 'other']).optional(),
  assigned_user_ids: z.array(uuidSchema).optional(),
  // Group calendar id. null = personal calendar (on update: move the entry off its group calendar;
  // on create: same as omitting it). Omitted on update = leave the calendar unchanged.
  calendar_id: uuidSchema.nullable().optional().describe(
    'Group calendar id (see GET /api/v1/calendars). null = personal calendar: on update moves the entry off its group calendar, on create is the same as omitting it. Omitted on update = calendar unchanged.'
  ),
  notes: z.string().optional(),
  is_private: z.boolean().optional().default(false),
  is_all_day: z.boolean().optional(),
  recurrence_pattern: z.string().optional()
});

// Schedule entry schemas (simplified for time management context)
export const createScheduleEntrySchema = baseScheduleEntrySchema.refine(data => {
  return new Date(data.scheduled_end) > new Date(data.scheduled_start);
}, {
  message: "Scheduled end time must be after start time",
  path: ["scheduled_end"]
});

export const updateScheduleEntrySchema = createUpdateSchema(baseScheduleEntrySchema).refine(data => {
  if (data.scheduled_start && data.scheduled_end) {
    return new Date(data.scheduled_end) > new Date(data.scheduled_start);
  }
  return true;
}, {
  message: "Scheduled end time must be after start time",
  path: ["scheduled_end"]
});

export const scheduleEntryResponseSchema = z.object({
  entry_id: uuidSchema,
  title: z.string(),
  scheduled_start: z.string().datetime(),
  scheduled_end: z.string().datetime(),
  work_item_id: uuidSchema.nullable(),
  work_item_type: z.string().nullable(),
  notes: z.string().nullable(),
  is_private: z.boolean(),
  is_all_day: z.boolean(),
  calendar_id: uuidSchema.nullable().optional(),
  status: z.string(),
  recurrence_pattern: z.string().nullable(),
  created_by: uuidSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Assigned users
  assigned_users: z.array(z.object({
    user_id: uuidSchema,
    first_name: z.string(),
    last_name: z.string(),
    email: z.string()
  })).optional(),
  
  // Work item details
  work_item: z.object({
    id: uuidSchema,
    title: z.string(),
    type: z.string()
  }).optional(),
  
  // Computed fields
  duration_hours: z.number().optional(),
  is_current: z.boolean().optional()
});

// Export types for TypeScript
export type CreateTimeSheetData = z.infer<typeof createTimeSheetSchema>;
export type UpdateTimeSheetData = z.infer<typeof updateTimeSheetSchema>;
export type TimeSheetFilterData = z.infer<typeof timeSheetFilterSchema>;
export type TimeSheetResponse = z.infer<typeof timeSheetResponseSchema>;
export type TimeSheetWithDetailsResponse = z.infer<typeof timeSheetWithDetailsResponseSchema>;
export type CreateTimePeriodData = z.infer<typeof createTimePeriodSchema>;
export type UpdateTimePeriodData = z.infer<typeof updateTimePeriodSchema>;
export type TimePeriodResponse = z.infer<typeof timePeriodResponseSchema>;
export type CreateTimePeriodSettingsData = z.infer<typeof createTimePeriodSettingsSchema>;
export type UpdateTimePeriodSettingsData = z.infer<typeof updateTimePeriodSettingsSchema>;
export type TimePeriodSettingsResponse = z.infer<typeof timePeriodSettingsResponseSchema>;
export type CreateTimeSheetCommentData = z.infer<typeof createTimeSheetCommentSchema>;
export type TimeSheetCommentResponse = z.infer<typeof timeSheetCommentResponseSchema>;
export type SubmitTimeSheetData = z.infer<typeof submitTimeSheetSchema>;
export type ApproveTimeSheetData = z.infer<typeof approveTimeSheetSchema>;
export type RequestChangesTimeSheetData = z.infer<typeof requestChangesTimeSheetSchema>;
export type BulkApproveTimeSheetData = z.infer<typeof bulkApproveTimeSheetSchema>;
export type ReverseApprovalData = z.infer<typeof reverseApprovalSchema>;
export type TimeSheetStatsResponse = z.infer<typeof timeSheetStatsResponseSchema>;
export type TimeSheetSearchData = z.infer<typeof timeSheetSearchSchema>;
export type TimeSheetExportQuery = z.infer<typeof timeSheetExportQuerySchema>;
// Calendars the caller can see (GET /api/v1/calendars)
export const calendarListQuerySchema = z.object({
  type: z.enum(['personal', 'group']).optional(),
  include_archived: z.enum(['true', 'false']).optional().default('false').transform((v) => v === 'true'),
});

export const calendarResponseSchema = z.object({
  calendar_id: uuidSchema.nullable().describe(
    'Group calendars: the id to send as calendar_id on a schedule entry. Personal calendars: always null, ' +
    'because a personal calendar is not addressed by an id on entries. To put an entry on someone\'s personal ' +
    'calendar, send calendar_id null (or omit it) together with assigned_user_ids: [owner_user_id].'
  ),
  name: z.string().describe('Group calendar name, or the owner\'s display name for a personal calendar.'),
  calendar_type: z.enum(['personal', 'group']),
  owner_user_id: uuidSchema.nullable().describe('Owner of a personal calendar (its identity in this list); null for group calendars.'),
  access_level: z.enum(['read', 'edit', 'manage', 'free_busy']).describe('Effective access level of the caller on this calendar.'),
  can_edit: z.boolean().describe('True when access_level is edit or manage.'),
  is_archived: z.boolean(),
});

export type CalendarListQuery = z.infer<typeof calendarListQuerySchema>;
export type CalendarResponse = z.infer<typeof calendarResponseSchema>;
export type CreateScheduleEntryData = z.infer<typeof createScheduleEntrySchema>;
export type UpdateScheduleEntryData = z.infer<typeof updateScheduleEntrySchema>;
export type ScheduleEntryResponse = z.infer<typeof scheduleEntryResponseSchema>;


// Schedule entry list/search query: ISO 8601 date (YYYY-MM-DD) or date-time.
// A date-only value names a whole UTC day: start_date=D means "starting at or
// after D 00:00Z" and end_date=D means "ending on or before D", i.e. strictly
// before (D+1) 00:00Z. Date-time values are exact, inclusive instants.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const scheduleQueryDateSchema = z.union([
  isoDateSchema.refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), 'Invalid date'),
  z.string().datetime({ offset: true }),
], { error: () => 'Expected ISO 8601 date or date-time' });

const scheduleEntryFilterShape = {
  start_date: scheduleQueryDateSchema.optional(),
  end_date: scheduleQueryDateSchema.optional(),
  user_id: uuidSchema.optional(),
};


/**
 * Filters handed to TimeSheetService schedule-entry queries. Exactly one of
 * end_date (inclusive instant) / end_before (exclusive instant) is set when the
 * caller bounded the end.
 */
export interface ScheduleEntryFilters {
  start_date?: string;
  end_date?: string;
  end_before?: string;
  user_id?: string;
}

// Checked on the normalized bounds, so start_date=2026-11-04T12:00Z with
// end_date=2026-11-04 (the whole day) is a valid range.
const startNotAfterEnd = ({ filters: f }: { filters: ScheduleEntryFilters }) =>
  !f.start_date
  || (!f.end_date || Date.parse(f.start_date) <= Date.parse(f.end_date))
  && (!f.end_before || Date.parse(f.start_date) < Date.parse(f.end_before));
const startNotAfterEndIssue = { message: 'start_date must not be after end_date', path: ['start_date'] };

function toScheduleEntryFilters(q: { start_date?: string; end_date?: string; user_id?: string }): ScheduleEntryFilters {
  const filters: ScheduleEntryFilters = {};
  if (q.start_date) {
    filters.start_date = DATE_ONLY.test(q.start_date) ? `${q.start_date}T00:00:00.000Z` : q.start_date;
  }
  if (q.end_date) {
    if (DATE_ONLY.test(q.end_date)) {
      const nextDay = new Date(`${q.end_date}T00:00:00.000Z`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      filters.end_before = nextDay.toISOString();
    } else {
      filters.end_date = q.end_date;
    }
  }
  if (q.user_id) {
    filters.user_id = q.user_id;
  }
  return filters;
}

// GET /api/v1/schedules: filters only. Deliberately unpaginated (returns every
// visible entry); page/limit are ignored for backwards compatibility.
export const scheduleEntryListQuerySchema = z.object(scheduleEntryFilterShape)
  .transform((q) => ({ filters: toScheduleEntryFilters(q) }))
  .refine(startNotAfterEnd, startNotAfterEndIssue);

// GET /api/v1/schedules/search: same filters plus page/limit.
export const scheduleEntrySearchQuerySchema = paginationQuerySchema
  .pick({ page: true, limit: true })
  .extend(scheduleEntryFilterShape)
  .transform(({ page, limit, ...q }) => ({ page, limit, filters: toScheduleEntryFilters(q) }))
  .refine(startNotAfterEnd, startNotAfterEndIssue);
