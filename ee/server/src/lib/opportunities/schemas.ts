import { z } from 'zod';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const opportunityPeriodSchema = z.object({
  start: dateSchema,
  end: dateSchema,
}).refine((period) => period.start <= period.end, {
  message: 'Period start must be on or before period end',
  path: ['end'],
});

export const meetingReviewSchema = z.object({
  session_id: z.string().uuid(),
  opportunity_id: z.string().uuid(),
  note: z.string().trim().max(4000).nullable().optional(),
});

export const createCommitmentSchema = z.object({
  description: z.string().trim().min(1).max(4000),
});

const commitmentResolutionSchema = z.enum([
  'open',
  'quote_line',
  'agreement_line',
  'project_task',
  'declined',
]);

export const updateCommitmentSchema = z.object({
  description: z.string().trim().min(1).max(4000).optional(),
  resolution_status: commitmentResolutionSchema.optional(),
  resolution_ref_id: z.string().uuid().nullable().optional(),
}).superRefine((input, ctx) => {
  if (!Object.values(input).some((value) => value !== undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one field is required' });
  }
  if (
    input.resolution_status
    && ['quote_line', 'agreement_line', 'project_task'].includes(input.resolution_status)
    && !input.resolution_ref_id
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'resolution_ref_id is required for linked resolutions',
      path: ['resolution_ref_id'],
    });
  }
  if ((input.resolution_status === 'open' || input.resolution_status === 'declined') && input.resolution_ref_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'resolution_ref_id is not valid for open or declined commitments',
      path: ['resolution_ref_id'],
    });
  }
});

export const createQbrOpportunitiesSchema = z.object({
  trigger_keys: z.array(z.string().trim().min(1)).min(1).max(100),
});
