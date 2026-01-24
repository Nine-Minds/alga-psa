import { z } from 'zod';
import { tenantSchema } from '@alga-psa/validation';

export const workItemTypeSchema = z.enum(['ticket', 'project_task', 'non_billable_category', 'ad_hoc', 'interaction']);


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

// Base schema without validation
const baseScheduleEntrySchema = tenantSchema.extend({
  entry_id: z.string().optional(), // Optional for creation
  work_item_id: z.string().nullable(),
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

// Validation function
const validateWorkItemId = (data: any, ctx: z.RefinementCtx) => {
  if (data.work_item_type === 'ad_hoc') {
    if (data.work_item_id !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Ad-hoc entries must not have a work item ID",
        path: ["work_item_id"]
      });
    }
  } else if (!data.work_item_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Non-ad-hoc entries must have a work item ID",
      path: ["work_item_id"]
    });
  }
};

// Main schema with validation
export const scheduleEntrySchema = baseScheduleEntrySchema.superRefine(validateWorkItemId);

// Input schema omits system-managed fields and includes validation
export const scheduleEntryInputSchema = baseScheduleEntrySchema
  .omit({
    entry_id: true,
    created_at: true,
    updated_at: true
  })
  .superRefine(validateWorkItemId);

// Update schema makes all fields optional and includes validation
export const scheduleEntryUpdateSchema = baseScheduleEntrySchema
  .partial()
  .superRefine(validateWorkItemId);

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
