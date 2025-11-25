import { z } from 'zod';

/**
 * Recurrence pattern for recurring schedule entries
 */
export interface RecurrencePattern {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  daysOfWeek?: number[];
  dayOfMonth?: number;
  monthOfYear?: number;
  startDate: Date;
  endDate?: Date;
  exceptions?: Date[];
  count?: number;
  workdaysOnly?: boolean;
}

/**
 * Schedule entry entity representing a scheduled event or task
 */
export interface ScheduleEntry {
  entry_id: string;
  tenant: string;
  work_item_id: string | null;
  assigned_user_ids: string[];
  scheduled_start: Date;
  scheduled_end: Date;
  status: string;
  notes?: string;
  title: string;
  recurrence_pattern?: RecurrencePattern | null;
  work_item_type: 'ticket' | 'project_task' | 'non_billable_category' | 'ad_hoc';
  created_at: Date;
  updated_at: Date;
  is_recurring?: boolean;
  original_entry_id?: string;
  is_private?: boolean;
}

/**
 * Appointment entity representing a scheduled appointment
 */
export interface Appointment {
  appointment_id: string;
  tenant: string;
  title: string;
  description?: string;
  start_time: Date;
  end_time: Date;
  location?: string;
  attendees: string[];
  organizer_user_id: string;
  status: 'scheduled' | 'confirmed' | 'cancelled' | 'completed';
  recurrence_rule?: string;
  is_all_day: boolean;
  reminders?: number[];
  created_at: Date;
  updated_at: Date;
}

/**
 * Resource entity for tracking user availability and capacity
 */
export interface Resource {
  resource_id: string;
  tenant: string;
  user_id: string;
  availability: any;
  skills: string[];
  max_daily_capacity: number;
  max_weekly_capacity: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Time slot for availability queries
 */
export interface TimeSlot {
  start: Date;
  end: Date;
  available: boolean;
  user_id?: string;
}

/**
 * Availability response
 */
export interface AvailabilityResult {
  user_id: string;
  slots: TimeSlot[];
  total_available_hours: number;
}

/**
 * Input schema for creating a schedule entry
 */
export const createScheduleEntrySchema = z.object({
  work_item_id: z.string().uuid().nullable().optional(),
  assigned_user_ids: z.array(z.string().uuid()).min(1, 'At least one user must be assigned'),
  scheduled_start: z.coerce.date(),
  scheduled_end: z.coerce.date(),
  status: z.string().max(50).default('scheduled'),
  notes: z.string().nullable().optional(),
  title: z.string().min(1, 'Title is required').max(255),
  recurrence_pattern: z.any().nullable().optional(),
  work_item_type: z.enum(['ticket', 'project_task', 'non_billable_category', 'ad_hoc']),
  is_recurring: z.boolean().default(false),
  original_entry_id: z.string().uuid().nullable().optional(),
  is_private: z.boolean().default(false),
});

export type CreateScheduleEntryInput = z.infer<typeof createScheduleEntrySchema>;

/**
 * Input schema for updating a schedule entry
 */
export const updateScheduleEntrySchema = createScheduleEntrySchema.partial().extend({
  entry_id: z.string().uuid(),
  update_type: z.enum(['single', 'future', 'all']).optional(),
});

export type UpdateScheduleEntryInput = z.infer<typeof updateScheduleEntrySchema>;

/**
 * Input schema for creating an appointment
 */
export const createAppointmentSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().nullable().optional(),
  start_time: z.coerce.date(),
  end_time: z.coerce.date(),
  location: z.string().max(255).nullable().optional(),
  attendees: z.array(z.string().uuid()),
  organizer_user_id: z.string().uuid(),
  status: z.enum(['scheduled', 'confirmed', 'cancelled', 'completed']).default('scheduled'),
  recurrence_rule: z.string().nullable().optional(),
  is_all_day: z.boolean().default(false),
  reminders: z.array(z.number()).optional(),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

/**
 * Input schema for updating an appointment
 */
export const updateAppointmentSchema = createAppointmentSchema.partial().extend({
  appointment_id: z.string().uuid(),
});

export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;

/**
 * Filters for querying schedule entries
 */
export interface ScheduleEntryFilters {
  user_ids?: string[];
  work_item_id?: string;
  work_item_type?: 'ticket' | 'project_task' | 'non_billable_category' | 'ad_hoc';
  status?: string;
  start_date?: Date;
  end_date?: Date;
  is_recurring?: boolean;
  is_private?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
  orderBy?: keyof ScheduleEntry;
  orderDirection?: 'asc' | 'desc';
}

/**
 * Filters for querying appointments
 */
export interface AppointmentFilters {
  attendee_user_ids?: string[];
  organizer_user_id?: string;
  status?: 'scheduled' | 'confirmed' | 'cancelled' | 'completed';
  start_date?: Date;
  end_date?: Date;
  is_all_day?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
  orderBy?: keyof Appointment;
  orderDirection?: 'asc' | 'desc';
}

/**
 * Availability query parameters
 */
export interface AvailabilityQuery {
  user_ids: string[];
  start_date: Date;
  end_date: Date;
  duration_minutes?: number;
  required_skills?: string[];
}

/**
 * Paginated response for schedule entry queries
 */
export interface ScheduleEntryListResponse {
  entries: ScheduleEntry[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Paginated response for appointment queries
 */
export interface AppointmentListResponse {
  appointments: Appointment[];
  total: number;
  limit: number;
  offset: number;
}
