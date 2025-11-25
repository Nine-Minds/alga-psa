import { z } from 'zod';

/**
 * Time entry approval status
 */
export type TimeSheetStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED';

/**
 * Work item types that can be tracked
 */
export type WorkItemType = 'ticket' | 'project_task' | 'non_billable_category' | 'ad_hoc' | 'interaction';

/**
 * Time entry entity representing a period of work on a work item
 */
export interface TimeEntry {
  entry_id: string;
  tenant: string;
  work_item_id: string;
  work_item_type: WorkItemType;
  start_time: string; // ISO8601String
  end_time: string; // ISO8601String
  billable_duration: number; // minutes
  notes: string;
  user_id: string;
  time_sheet_id?: string;
  approval_status: TimeSheetStatus;
  service_id?: string;
  tax_region?: string;
  contract_line_id?: string;
  tax_rate_id?: string | null;
  tax_percentage?: number | null;
  created_at: string; // ISO8601String
  updated_at: string; // ISO8601String
}

/**
 * Time sheet entity grouping time entries by period
 */
export interface TimeSheet {
  id: string;
  tenant: string;
  period_id: string;
  user_id: string;
  approval_status: TimeSheetStatus;
  submitted_at?: string; // ISO8601String
  approved_at?: string; // ISO8601String
  approved_by?: string;
}

/**
 * Time sheet with approval details
 */
export interface TimeSheetApproval extends TimeSheet {
  employee_name: string;
  employee_email: string;
  comments: TimeSheetComment[];
}

/**
 * Comment on a time sheet
 */
export interface TimeSheetComment {
  comment_id: string;
  tenant: string;
  time_sheet_id: string;
  user_id: string;
  comment: string;
  created_at: string; // ISO8601String
  is_approver: boolean;
  user_name?: string;
}

/**
 * Time period for grouping time entries
 */
export interface TimePeriod {
  period_id: string;
  tenant: string;
  start_date: string; // DateValue or string representation
  end_date: string; // DateValue or string representation
}

/**
 * Input schema for creating a new time entry
 */
export const createTimeEntrySchema = z.object({
  work_item_id: z.string().min(1, 'Work item ID is required'),
  work_item_type: z.enum(['ticket', 'project_task', 'non_billable_category', 'ad_hoc', 'interaction']),
  start_time: z.string().min(1, 'Start time is required'),
  end_time: z.string().min(1, 'End time is required'),
  billable_duration: z.number().nonnegative(),
  notes: z.string().default(''),
  time_sheet_id: z.string().optional(),
  approval_status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED']).default('DRAFT'),
  service_id: z.string().optional(),
  tax_region: z.string().optional(),
  contract_line_id: z.string().optional(),
  tax_rate_id: z.string().nullable().optional(),
});

export type CreateTimeEntryInput = z.infer<typeof createTimeEntrySchema>;

/**
 * Input schema for updating an existing time entry
 */
export const updateTimeEntrySchema = createTimeEntrySchema.partial().extend({
  entry_id: z.string().min(1, 'Entry ID is required'),
});

export type UpdateTimeEntryInput = z.infer<typeof updateTimeEntrySchema>;

/**
 * Input schema for starting time tracking
 */
export const startTrackingSchema = z.object({
  work_item_id: z.string().min(1, 'Work item ID is required'),
  work_item_type: z.enum(['ticket', 'project_task', 'non_billable_category', 'ad_hoc', 'interaction']),
  notes: z.string().optional(),
  service_id: z.string().optional(),
});

export type StartTrackingInput = z.infer<typeof startTrackingSchema>;

/**
 * Input schema for stopping time tracking
 */
export const stopTrackingSchema = z.object({
  entry_id: z.string().min(1, 'Entry ID is required'),
  notes: z.string().optional(),
  billable_duration: z.number().nonnegative().optional(),
});

export type StopTrackingInput = z.infer<typeof stopTrackingSchema>;

/**
 * Filters for querying time entries
 */
export interface TimeEntryFilters {
  user_id?: string;
  work_item_id?: string;
  work_item_type?: WorkItemType;
  time_sheet_id?: string;
  approval_status?: TimeSheetStatus;
  start_date?: string; // ISO8601String
  end_date?: string; // ISO8601String
  service_id?: string;
  is_billable?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: keyof TimeEntry;
  orderDirection?: 'asc' | 'desc';
}

/**
 * Paginated response for time entry queries
 */
export interface TimeEntryListResponse {
  entries: TimeEntry[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Time entry with work item details
 */
export interface TimeEntryWithWorkItem extends TimeEntry {
  workItem: {
    work_item_id: string;
    name: string;
    description?: string;
    type: WorkItemType;
    is_billable: boolean;
    [key: string]: unknown; // Additional work item specific fields
  };
}
