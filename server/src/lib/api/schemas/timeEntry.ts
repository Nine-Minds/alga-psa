/**
 * Time Entry API Schemas
 * Validation schemas for time entry-related API endpoints
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

// Work item type schema
export const workItemTypeSchema = z.enum(['ticket', 'project_task', 'non_billable_category', 'ad_hoc', 'interaction']);

// Approval status schema
export const approvalStatusSchema = z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED']);

// Base time entry schema (without refinements)
const baseTimeEntrySchema = z.object({
  work_item_id: uuidSchema.optional(),
  work_item_type: workItemTypeSchema,
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  notes: z.string().optional(),
  service_id: uuidSchema.optional(),
  tax_region: z.string().optional(),
  is_billable: z.boolean().optional().default(true)
});

// Create time entry schema
export const createTimeEntrySchema = baseTimeEntrySchema.refine(data => {
  // Validate that end_time is after start_time
  if (data.start_time && data.end_time) {
    return new Date(data.end_time) > new Date(data.start_time);
  }
  return true;
}, {
  message: "End time must be after start time",
  path: ["end_time"]
});

// Update time entry schema (all fields optional except validation)
export const updateTimeEntrySchema = createUpdateSchema(baseTimeEntrySchema).refine(data => {
  // Validate that end_time is after start_time if both are provided
  if (data.start_time && data.end_time) {
    return new Date(data.end_time) > new Date(data.start_time);
  }
  return true;
}, {
  message: "End time must be after start time",
  path: ["end_time"]
});

// Time entry filter schema
export const timeEntryFilterSchema = baseFilterSchema.extend({
  user_id: uuidSchema.optional(),
  work_item_id: uuidSchema.optional(),
  work_item_type: workItemTypeSchema.optional(),
  service_id: uuidSchema.optional(),
  approval_status: approvalStatusSchema.optional(),
  is_billable: booleanTransform.optional(),
  start_time_from: z.string().datetime().optional(),
  start_time_to: z.string().datetime().optional(),
  end_time_from: z.string().datetime().optional(),
  end_time_to: z.string().datetime().optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time_sheet_id: uuidSchema.optional(),
  contract_line_id: uuidSchema.optional(),
  client_id: uuidSchema.optional(),
  duration_min: z.string().transform(val => parseInt(val)).optional(),
  duration_max: z.string().transform(val => parseInt(val)).optional()
});

// Time entry list query schema
export const timeEntryListQuerySchema = createListQuerySchema(timeEntryFilterSchema);

// Time entry response schema
export const timeEntryResponseSchema = z.object({
  entry_id: uuidSchema,
  work_item_id: uuidSchema.nullable(),
  work_item_type: workItemTypeSchema,
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  billable_duration: z.number(), // in minutes
  notes: z.string().nullable(),
  user_id: uuidSchema,
  time_sheet_id: uuidSchema.nullable(),
  approval_status: approvalStatusSchema,
  service_id: uuidSchema.nullable(),
  tax_region: z.string().nullable(),
  contract_line_id: uuidSchema.nullable(),
  tax_rate_id: uuidSchema.nullable(),
  tax_percentage: z.number().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Computed/joined fields
  user_name: z.string().optional(),
  work_item_title: z.string().optional(),
  service_name: z.string().optional(),
  client_name: z.string().optional(),
  duration_hours: z.number().optional(),
  is_billable: z.boolean().optional()
});

// Time entry with details response schema
export const timeEntryWithDetailsResponseSchema = timeEntryResponseSchema.extend({
  user: z.object({
    user_id: uuidSchema,
    first_name: z.string(),
    last_name: z.string(),
    email: z.string()
  }).optional(),
  
  work_item: z.object({
    id: uuidSchema,
    title: z.string(),
    type: workItemTypeSchema,
    client_id: uuidSchema.optional(),
    project_id: uuidSchema.optional()
  }).optional(),
  
  service: z.object({
    service_id: uuidSchema,
    service_name: z.string(),
    default_rate: z.number().optional(),
    billing_unit: z.string().optional()
  }).optional(),
  
  time_sheet: z.object({
    id: uuidSchema,
    period_id: uuidSchema,
    approval_status: approvalStatusSchema,
    submitted_at: z.string().datetime().nullable(),
    approved_at: z.string().datetime().nullable()
  }).optional(),
  
  billing_info: z.object({
    contract_line_id: uuidSchema.nullable(),
    contract_line_name: z.string().nullable(),
    rate: z.number().nullable(),
    tax_rate: z.number().nullable(),
    total_amount: z.number().nullable()
  }).optional()
});

// Bulk time entry operations
export const bulkTimeEntrySchema = z.object({
  entries: z.array(createTimeEntrySchema).min(1).max(50)
});

export const bulkUpdateTimeEntrySchema = z.object({
  entries: z.array(z.object({
    entry_id: uuidSchema,
    data: updateTimeEntrySchema
  })).min(1).max(50)
});

export const bulkDeleteTimeEntrySchema = z.object({
  entry_ids: z.array(uuidSchema).min(1).max(50)
});

// Time tracking templates
export const createTimeTemplateSchema = z.object({
  template_name: z.string().min(1, 'Template name is required'),
  work_item_type: workItemTypeSchema,
  work_item_id: uuidSchema.optional(),
  service_id: uuidSchema.optional(),
  default_notes: z.string().optional(),
  is_active: z.boolean().optional().default(true)
});

export const timeTemplateResponseSchema = z.object({
  template_id: uuidSchema,
  template_name: z.string(),
  work_item_type: workItemTypeSchema,
  work_item_id: uuidSchema.nullable(),
  service_id: uuidSchema.nullable(),
  default_notes: z.string().nullable(),
  is_active: z.boolean(),
  user_id: uuidSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Related data
  work_item_title: z.string().optional(),
  service_name: z.string().optional()
});

// Time entry statistics
export const timeEntryStatsResponseSchema = z.object({
  total_entries: z.number(),
  total_billable_hours: z.number(),
  total_non_billable_hours: z.number(),
  billable_percentage: z.number(),
  entries_by_type: z.record(z.number()),
  entries_by_status: z.record(z.number()),
  entries_by_user: z.record(z.number()),
  entries_by_service: z.record(z.number()),
  total_revenue: z.number(),
  average_entry_duration: z.number(),
  entries_this_week: z.number(),
  entries_this_month: z.number(),
  top_work_items: z.array(z.object({
    work_item_id: uuidSchema,
    work_item_title: z.string(),
    total_hours: z.number(),
    entry_count: z.number()
  }))
});

// Time entry search schema
export const timeEntrySearchSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  fields: z.array(z.enum(['notes', 'work_item_title', 'user_name', 'service_name'])).optional(),
  work_item_types: z.array(workItemTypeSchema).optional(),
  approval_statuses: z.array(approvalStatusSchema).optional(),
  user_ids: z.array(uuidSchema).optional(),
  service_ids: z.array(uuidSchema).optional(),
  date_from: dateSchema.optional(),
  date_to: dateSchema.optional(),
  billable_only: booleanTransform.optional(),
  limit: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(100)).optional().default('25')
});

// Time entry export schema
export const timeEntryExportQuerySchema = z.object({
  format: z.enum(['csv', 'json', 'xlsx']).optional().default('csv'),
  include_billing_info: booleanTransform.optional().default("false"),
  include_work_item_details: booleanTransform.optional().default("false"),
  group_by: z.enum(['user', 'work_item', 'service', 'date', 'none']).optional().default('none'),
  work_item_types: z.array(workItemTypeSchema).optional(),
  approval_statuses: z.array(approvalStatusSchema).optional(),
  user_ids: z.array(uuidSchema).optional(),
  user_id: uuidSchema.optional(),
  work_item_id: uuidSchema.optional(),
  work_item_type: workItemTypeSchema.optional(),
  service_id: uuidSchema.optional(),
  approval_status: approvalStatusSchema.optional(),
  is_billable: booleanTransform.optional(),
  start_time_from: z.string().datetime().optional(),
  start_time_to: z.string().datetime().optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format. Expected YYYY-MM-DD').optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format. Expected YYYY-MM-DD').optional(),
  fields: z.array(z.string()).optional()
});

// Time tracking active session
export const startTimeTrackingSchema = z.object({
  work_item_id: uuidSchema.optional(),
  work_item_type: workItemTypeSchema,
  notes: z.string().optional(),
  service_id: uuidSchema.optional()
});

export const activeTimeSessionResponseSchema = z.object({
  session_id: uuidSchema,
  work_item_id: uuidSchema.nullable(),
  work_item_type: workItemTypeSchema,
  start_time: z.string().datetime(),
  notes: z.string().nullable(),
  service_id: uuidSchema.nullable(),
  user_id: uuidSchema,
  created_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Computed fields
  elapsed_minutes: z.number(),
  work_item_title: z.string().optional(),
  service_name: z.string().optional()
});

export const stopTimeTrackingSchema = z.object({
  end_time: z.string().datetime().optional(), // If not provided, uses current time
  notes: z.string().optional(),
  service_id: uuidSchema.optional(),
  is_billable: z.boolean().optional()
});

// Time entry approval operations
export const approveTimeEntriesSchema = z.object({
  entry_ids: z.array(uuidSchema).min(1).max(100),
  approval_notes: z.string().optional()
});

export const requestTimeEntryChangesSchema = z.object({
  entry_ids: z.array(uuidSchema).min(1).max(100),
  change_reason: z.string().min(1, 'Change reason is required'),
  detailed_feedback: z.string().optional()
});

// Export types for TypeScript
export type CreateTimeEntryData = z.infer<typeof createTimeEntrySchema>;
export type UpdateTimeEntryData = z.infer<typeof updateTimeEntrySchema>;
export type TimeEntryFilterData = z.infer<typeof timeEntryFilterSchema>;
export type TimeEntryResponse = z.infer<typeof timeEntryResponseSchema>;
export type TimeEntryWithDetailsResponse = z.infer<typeof timeEntryWithDetailsResponseSchema>;
export type BulkTimeEntryData = z.infer<typeof bulkTimeEntrySchema>;
export type BulkUpdateTimeEntryData = z.infer<typeof bulkUpdateTimeEntrySchema>;
export type BulkDeleteTimeEntryData = z.infer<typeof bulkDeleteTimeEntrySchema>;
export type CreateTimeTemplateData = z.infer<typeof createTimeTemplateSchema>;
export type TimeTemplateResponse = z.infer<typeof timeTemplateResponseSchema>;
export type TimeEntryStatsResponse = z.infer<typeof timeEntryStatsResponseSchema>;
export type TimeEntrySearchData = z.infer<typeof timeEntrySearchSchema>;
export type TimeEntryExportQuery = z.infer<typeof timeEntryExportQuerySchema>;
export type StartTimeTrackingData = z.infer<typeof startTimeTrackingSchema>;
export type ActiveTimeSessionResponse = z.infer<typeof activeTimeSessionResponseSchema>;
export type StopTimeTrackingData = z.infer<typeof stopTimeTrackingSchema>;
export type ApproveTimeEntriesData = z.infer<typeof approveTimeEntriesSchema>;
export type RequestTimeEntryChangesData = z.infer<typeof requestTimeEntryChangesSchema>;