import { z } from 'zod';
import {
  timeEntrySchema,
  workItemTypeSchema,
} from './timeSheet.schemas';

// Work item schema (unique to timeEntry.schemas.ts)
export const workItemSchema = z.object({
  work_item_id: z.string(),
  type: workItemTypeSchema,
  name: z.string(),
  description: z.string(),
  is_billable: z.boolean(),
  tenant: z.string().optional(),
});

// Query parameter schemas
export const fetchTimeEntriesParamsSchema = z.object({
  timeSheetId: z.string(),
});

export const saveTimeEntryParamsSchema = timeEntrySchema.omit({ tenant: true });

export const addWorkItemParamsSchema = workItemSchema.omit({ tenant: true });

export const submitTimeSheetParamsSchema = z.object({
  timeSheetId: z.string(),
});

export const fetchOrCreateTimeSheetParamsSchema = z.object({
  userId: z.string(),
  periodId: z.string(),
});

export const fetchTimePeriodsParamsSchema = z.object({
  userId: z.string(),
});

// Re-export schemas from timeSheet.schemas.ts for convenience
export {
  timeEntrySchema,
  timeSheetSchema,
  timePeriodSchema,
  workItemTypeSchema,
  timeSheetStatusSchema
} from './timeSheet.schemas';

export { validateData } from '@alga-psa/core';