
import { z } from 'zod';
import { timeEntrySchema, timeSheetStatusSchema } from '../schemas/timeSheet.schemas';

export const fetchTimeEntriesParamsSchema = z.object({
  timeSheetId: z.string().min(1, "Time sheet ID is required"),
});

export type FetchTimeEntriesParams = z.infer<typeof fetchTimeEntriesParamsSchema>;

export const saveTimeEntryParamsSchema = timeEntrySchema.superRefine((data, ctx) => {
  if (!data.service_id?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['service_id'],
      message: 'service_id is required for time entries',
    });
  }
});

export type SaveTimeEntryParams = z.infer<typeof saveTimeEntryParamsSchema>;

export const updateTimeEntryApprovalStatusParamsSchema = z.object({
  entryId: z.string().min(1, 'Time entry ID is required'),
  approvalStatus: timeSheetStatusSchema,
  changeRequestComment: z.string().trim().optional(),
});

export type UpdateTimeEntryApprovalStatusParams = z.infer<typeof updateTimeEntryApprovalStatusParamsSchema>;

export const addWorkItemParamsSchema = z.object({
  work_item_id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  type: z.string(),
  is_billable: z.boolean(),
});

export type AddWorkItemParams = z.infer<typeof addWorkItemParamsSchema>;

export const submitTimeSheetParamsSchema = z.object({
  timeSheetId: z.string().min(1, "Time sheet ID is required"),
});

export type SubmitTimeSheetParams = z.infer<typeof submitTimeSheetParamsSchema>;

export const fetchOrCreateTimeSheetParamsSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  periodId: z.string().min(1, "Period ID is required"),
});

export type FetchOrCreateTimeSheetParams = z.infer<typeof fetchOrCreateTimeSheetParamsSchema>;

export const fetchTimePeriodsParamsSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
});

export type FetchTimePeriodsParams = z.infer<typeof fetchTimePeriodsParamsSchema>;
