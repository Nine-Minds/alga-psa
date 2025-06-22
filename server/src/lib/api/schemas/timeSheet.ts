/**
 * Time Sheet API Schemas
 * Validation schemas for time sheet-related API endpoints
 */

import { z } from 'zod';
import { 
  uuidSchema, 
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
  booleanTransform,
  dateSchema
} from './common';
import { approvalStatusSchema, timeEntryResponseSchema } from './timeEntry';

// Time period frequency schema
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
export const timeSheetListQuerySchema = createListQuerySchema(timeSheetFilterSchema);

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
    start_date: dateSchema,
    end_date: dateSchema,
    is_current: z.boolean()
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
    entries_by_type: z.record(z.number()),
    entries_by_day: z.record(z.number()),
    approval_ready: z.boolean()
  }).optional()
});

// Time period schemas
export const createTimePeriodSchema = z.object({
  start_date: dateSchema,
  end_date: dateSchema,
  is_current: z.boolean().optional().default(false)
});

export const updateTimePeriodSchema = createUpdateSchema(createTimePeriodSchema);

export const timePeriodResponseSchema = z.object({
  period_id: uuidSchema,
  start_date: dateSchema,
  end_date: dateSchema,
  is_current: z.boolean(),
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
  time_sheets_by_status: z.record(z.number()),
  time_sheets_by_user: z.record(z.number()),
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

// Time sheet search schema
export const timeSheetSearchSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  fields: z.array(z.enum(['user_name', 'notes', 'approval_notes'])).optional(),
  approval_statuses: z.array(approvalStatusSchema).optional(),
  user_ids: z.array(uuidSchema).optional(),
  period_ids: z.array(uuidSchema).optional(),
  date_from: dateSchema.optional(),
  date_to: dateSchema.optional(),
  include_entries: booleanTransform.optional().default("false"),
  limit: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(100)).optional().default('25')
});

// Time sheet export schema
export const timeSheetExportQuerySchema = z.object({
  format: z.enum(['csv', 'json', 'xlsx']).optional().default('csv'),
  include_time_entries: booleanTransform.optional().default("false"),
  include_comments: booleanTransform.optional().default("false"),
  group_by: z.enum(['user', 'period', 'status', 'none']).optional().default('none'),
  approval_statuses: z.array(approvalStatusSchema).optional(),
  user_ids: z.array(uuidSchema).optional(),
  period_ids: z.array(uuidSchema).optional(),
  date_from: dateSchema.optional(),
  date_to: dateSchema.optional(),
  fields: z.array(z.string()).optional()
});

// Time period generation
export const generateTimePeriodsSchema = z.object({
  start_date: dateSchema,
  end_date: dateSchema,
  frequency: timePeriodFrequencySchema,
  frequency_unit: z.number().min(1).optional().default(1)
});

// Base schedule entry schema (without refinements)
const baseScheduleEntrySchema = z.object({
  title: z.string().min(1, 'Title is required'),
  scheduled_start: z.string().datetime(),
  scheduled_end: z.string().datetime(),
  work_item_id: uuidSchema.optional(),
  work_item_type: z.enum(['ticket', 'project_task', 'meeting', 'break', 'other']).optional(),
  assigned_user_ids: z.array(uuidSchema).optional(),
  notes: z.string().optional(),
  is_private: z.boolean().optional().default(false),
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
export type GenerateTimePeriodsData = z.infer<typeof generateTimePeriodsSchema>;
export type CreateScheduleEntryData = z.infer<typeof createScheduleEntrySchema>;
export type UpdateScheduleEntryData = z.infer<typeof updateScheduleEntrySchema>;
export type ScheduleEntryResponse = z.infer<typeof scheduleEntryResponseSchema>;