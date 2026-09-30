import { z } from 'zod';
import {
  completeNextActionSchema,
  completeOpportunityStepSchema,
  correctEvidenceSchema,
  createOpportunitySchema,
  loseOpportunitySchema,
  opportunityStageSchema,
  opportunityStatusSchema,
  recordDeclaredEvidenceSchema,
  updateOpportunitySchema,
  winOpportunitySchema,
  acceptSuggestionOverridesSchema,
  snoozeSuggestionSchema,
  opportunitySuggestionStatusSchema,
} from '@alga-psa/opportunities/schemas';

const positiveIntegerQuery = z.string()
  .regex(/^\d+$/, 'Must be a positive integer')
  .transform(Number)
  .refine((value) => value > 0, 'Must be a positive integer');

export const createOpportunityApiSchema = createOpportunitySchema;

// The package schema stays pure — stage/status/next-action belong to their
// dedicated flows. The REST layer accepts them anyway so a full-body
// read-modify-write PUT still round-trips, and so a caller that actually tries
// to *change* one gets a 400 naming the canonical endpoint instead of a silent
// field drop. OpportunityService.update enforces that distinction.
export const updateOpportunityApiSchema = updateOpportunitySchema.extend({
  stage: opportunityStageSchema.optional(),
  status: opportunityStatusSchema.optional(),
  // Nullable: a closed opportunity has no current step, so GET returns
  // next_action/next_action_due as null and the echo has to validate.
  next_action: z.string().trim().min(1).nullable().optional(),
  next_action_due: z.string().datetime().nullable().optional(),
});
export const setOpportunityStageApiSchema = z.object({
  stage: opportunityStageSchema,
  detail: z.string().trim().optional().nullable(),
});
export const winOpportunityApiSchema = winOpportunitySchema;
export const loseOpportunityApiSchema = loseOpportunitySchema;
export const completeOpportunityActionApiSchema = completeNextActionSchema;
export const completeOpportunityStepApiSchema = completeOpportunityStepSchema;
export const declaredOpportunityEvidenceApiSchema = recordDeclaredEvidenceSchema;
export const correctOpportunityEvidenceApiSchema = correctEvidenceSchema;
export const acceptOpportunitySuggestionApiSchema = acceptSuggestionOverridesSchema;
export const snoozeOpportunitySuggestionApiSchema = snoozeSuggestionSchema;
export const opportunitySuggestionListQuerySchema = z.object({
  status: opportunitySuggestionStatusSchema.optional(),
});

export const opportunityListQuerySchema = z.object({
  status: z.enum(['open', 'won', 'lost', 'all']).optional(),
  stage: z.enum(['identified', 'qualified', 'assessment', 'proposed', 'verbal', 'won', 'lost']).optional(),
  owner_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
  opportunity_type: z.enum(['new_logo', 'expansion', 'renewal', 'project']).optional(),
  stalled_only: z.enum(['true', 'false']).optional().transform((value) => value === undefined ? undefined : value === 'true'),
  search: z.string().trim().min(1).optional(),
  page: positiveIntegerQuery.optional().default('1'),
  page_size: positiveIntegerQuery.optional().default('25').transform((value) => Math.min(value, 100)),
  sort_by: z.enum([
    'next_action_due',
    'expected_close_date',
    'mrr_cents',
    'last_activity_at',
    'created_at',
  ]).optional().default('next_action_due'),
  sort_direction: z.enum(['asc', 'desc']).optional().default('asc'),
});

export type CreateOpportunityApi = z.infer<typeof createOpportunityApiSchema>;
export type UpdateOpportunityApi = z.infer<typeof updateOpportunityApiSchema>;
export type SetOpportunityStageApi = z.infer<typeof setOpportunityStageApiSchema>;
export type WinOpportunityApi = z.infer<typeof winOpportunityApiSchema>;
export type LoseOpportunityApi = z.infer<typeof loseOpportunityApiSchema>;
export type CompleteOpportunityActionApi = z.infer<typeof completeOpportunityActionApiSchema>;
export type CompleteOpportunityStepApi = z.infer<typeof completeOpportunityStepApiSchema>;
export type DeclaredOpportunityEvidenceApi = z.infer<typeof declaredOpportunityEvidenceApiSchema>;
export type CorrectOpportunityEvidenceApi = z.infer<typeof correctOpportunityEvidenceApiSchema>;
export type AcceptOpportunitySuggestionApi = z.infer<typeof acceptOpportunitySuggestionApiSchema>;
export type SnoozeOpportunitySuggestionApi = z.infer<typeof snoozeOpportunitySuggestionApiSchema>;
export type OpportunityListQuery = z.infer<typeof opportunityListQuerySchema>;
