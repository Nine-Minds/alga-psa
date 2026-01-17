/**
 * Alga Guard - Schedule Interfaces
 */

// Schedule type
export type GuardScheduleType = 'pii_scan' | 'asm_scan';

// Schedule frequency
export type GuardScheduleFrequency = 'daily' | 'weekly' | 'monthly';

// Day of week for weekly schedules
export type GuardDayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

// Guard Schedule
export interface IGuardSchedule {
  id: string;
  tenant: string;
  name: string;
  description?: string;
  schedule_type: GuardScheduleType;
  frequency: GuardScheduleFrequency;
  day_of_week?: GuardDayOfWeek;  // For weekly
  day_of_month?: number;  // For monthly (1-28)
  time_of_day: string;  // HH:MM format (24-hour)
  timezone: string;  // IANA timezone (e.g., 'America/New_York')
  target_id: string;  // Profile ID for PII or Domain ID for ASM
  enabled: boolean;
  next_run_at?: Date;
  last_run_at?: Date;
  created_at: Date;
  updated_at: Date;
  created_by?: string;
}

// Schedule with target details
export interface IGuardScheduleWithTarget extends IGuardSchedule {
  target_name: string;  // Profile name or domain name
}

// Create schedule request
export interface ICreateScheduleRequest {
  name: string;
  description?: string;
  schedule_type: GuardScheduleType;
  frequency: GuardScheduleFrequency;
  day_of_week?: GuardDayOfWeek;
  day_of_month?: number;
  time_of_day: string;
  timezone?: string;
  target_id: string;
  enabled?: boolean;
}

// Update schedule request
export interface IUpdateScheduleRequest {
  name?: string;
  description?: string;
  frequency?: GuardScheduleFrequency;
  day_of_week?: GuardDayOfWeek;
  day_of_month?: number;
  time_of_day?: string;
  timezone?: string;
  target_id?: string;
  enabled?: boolean;
}

// Schedule list params
export interface IGuardScheduleListParams {
  page?: number;
  page_size?: number;
  sort_by?: 'name' | 'next_run_at' | 'created_at';
  sort_order?: 'asc' | 'desc';
  schedule_type?: GuardScheduleType;
  enabled?: boolean;
}

// Paginated response
export interface IGuardSchedulePaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// Schedule execution result
export interface IScheduleExecutionResult {
  schedule_id: string;
  job_id: string;
  scheduled_at: Date;
  executed_at: Date;
  status: 'success' | 'failed';
  error_message?: string;
}

// Days of week mapping for calculation
export const DAY_OF_WEEK_MAP: Record<GuardDayOfWeek, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

// Default timezone
export const DEFAULT_TIMEZONE = 'UTC';

// Validation constants
export const MIN_DAY_OF_MONTH = 1;
export const MAX_DAY_OF_MONTH = 28;  // Use 28 to ensure validity in all months

// Time format regex (HH:MM, 24-hour)
export const TIME_FORMAT_REGEX = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
