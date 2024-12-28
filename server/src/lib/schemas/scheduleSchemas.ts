import { z } from 'zod';
import { tenantSchema } from '../utils/validation';

export const workItemTypeSchema = z.enum(['ticket', 'project_task', 'non_billable_category']);


export const recurrencePatternSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().positive(),
  daysOfWeek: z.array(z.number().min(0).max(6)).optional(),
  dayOfMonth: z.number().min(1).max(31).optional(),
  monthOfYear: z.number().min(1).max(12).optional(),
  startDate: z.date(),
  endDate: z.date().optional(),
  exceptions: z.array(z.date()).optional(),
  count: z.number().positive().optional()
});

export const scheduleEntrySchema = tenantSchema.extend({
  entry_id: z.string().optional(), // Optional for creation
  work_item_id: z.string(),
  assigned_user_ids: z.array(z.string()).min(1), // At least one assigned user required
  scheduled_start: z.date(),
  scheduled_end: z.date(),
  status: z.string(),
  notes: z.string().optional(),
  title: z.string(),
  recurrence_pattern: recurrencePatternSchema.nullable().optional(),
  work_item_type: workItemTypeSchema,
  created_at: z.date().optional(),
  updated_at: z.date().optional(),
  isRecurring: z.boolean().optional(),
  originalEntryId: z.string().optional()
});

// Input schema omits system-managed fields
export const scheduleEntryInputSchema = scheduleEntrySchema.omit({
  entry_id: true,
  created_at: true,
  updated_at: true
});

// Update schema makes all fields optional
export const scheduleEntryUpdateSchema = scheduleEntrySchema.partial();

// Query schemas
export const getScheduleEntriesSchema = z.object({
  start: z.date(),
  end: z.date()
});

export const updateRecurringEntrySchema = z.object({
  entry_id: z.string(),
  data: scheduleEntryUpdateSchema,
  updateType: z.enum(['single', 'future', 'all'])
});
