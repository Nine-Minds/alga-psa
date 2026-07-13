import { z } from 'zod';
import type {
  OpportunityCheckpoint,
  OpportunityConfidence,
  OpportunityGeneratorKey,
  OpportunityListFilters,
  OpportunityLossReason,
  OpportunityStage,
  OpportunityStatus,
  OpportunityType,
} from '@alga-psa/types';

export const opportunityStatusSchema: z.ZodType<OpportunityStatus> = z.enum(['open', 'won', 'lost']);
export const opportunityTypeSchema: z.ZodType<OpportunityType> = z.enum(['new_logo', 'expansion', 'renewal', 'project']);
export const opportunityStageSchema: z.ZodType<OpportunityStage> = z.enum([
  'identified',
  'qualified',
  'assessment',
  'proposed',
  'verbal',
  'won',
  'lost',
]);
export const opportunityConfidenceSchema: z.ZodType<OpportunityConfidence> = z.enum([
  'low',
  'medium',
  'high',
  'committed',
]);
export const opportunityLossReasonSchema: z.ZodType<OpportunityLossReason> = z.enum([
  'no_response',
  'chose_competitor',
  'price',
  'timing',
  'no_budget',
  'not_a_fit',
  'other',
]);
export const opportunityGeneratorKeySchema: z.ZodType<OpportunityGeneratorKey> = z.enum([
  'renewal',
  'tm_conversion',
  'whitespace',
  'asset_aging',
]);
export const opportunitySuggestionStatusSchema = z.enum([
  'pending',
  'accepted',
  'dismissed',
  'snoozed',
]);

export const opportunitySettingsSchema = z.object({
  nudge_days: z.number().int().min(1),
  interrupt_days: z.number().int().min(2),
  escalation_mode: z.enum(['solo', 'team']),
  renewal_lead_days: z.number().int().min(1).default(120),
  tm_threshold_cents: z.number().int().nonnegative().default(120000),
  asset_age_years: z.number().int().min(1).default(6),
  assessment_service_ids: z.array(z.string().uuid()).max(100).optional(),
}).superRefine((value, ctx) => {
  if (value.interrupt_days <= value.nudge_days) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['interrupt_days'],
      message: 'Interrupt days must be greater than nudge days',
    });
  }
});

const expectedCloseDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected close date must use YYYY-MM-DD format');
const centsSchema = z.number().int().nonnegative();

export const createOpportunitySchema = z.object({
  client_id: z.string().uuid(),
  contact_id: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1),
  opportunity_type: opportunityTypeSchema,
  owner_id: z.string().uuid().optional(),
  confidence: opportunityConfidenceSchema.default('medium'),
  mrr_cents: centsSchema.default(0),
  nrr_cents: centsSchema.default(0),
  hardware_cents: centsSchema.default(0),
  currency_code: z.string().trim().length(3),
  expected_close_date: expectedCloseDateSchema.optional().nullable(),
  next_action: z.string().trim().min(1),
  next_action_due: z.string().datetime(),
  generator_key: opportunityGeneratorKeySchema.optional().nullable(),
  generator_context: z.record(z.unknown()).optional().nullable(),
  suggestion_id: z.string().uuid().optional().nullable(),
});

// Status and stage are intentionally absent: dedicated win/lose and evidence
// flows own those transitions.
export const updateOpportunitySchema = createOpportunitySchema.partial();

export const winOpportunitySchema = z.object({
  convert_quote_id: z.string().uuid().optional(),
  project_template_id: z.string().uuid().optional(),
}).strict();

export const loseOpportunitySchema = z.object({
  loss_reason: opportunityLossReasonSchema,
  loss_notes: z.string().trim().optional().nullable(),
  lost_to: z.string().trim().optional().nullable(),
});

const declaredCheckpointSchema: z.ZodType<Extract<OpportunityCheckpoint, 'qualified'>> = z.enum(['qualified']);

export const recordDeclaredEvidenceSchema = z.object({
  checkpoint: declaredCheckpointSchema,
  detail: z.string().trim().optional().nullable(),
});

export const completeNextActionSchema = z.object({
  next_action: z.string().trim().min(1),
  next_action_due: z.string().datetime(),
});

export const correctEvidenceSchema = z.object({
  correction_note: z.string().trim().min(1),
});

export const linkQuoteSchema = z.object({
  quote_id: z.string().uuid(),
});

export const suggestionActionSchema = z.object({
  action: z.enum(['accept', 'dismiss', 'snooze']),
  snoozed_until: z.string().datetime().optional().nullable(),
}).superRefine((value, ctx) => {
  if (value.action === 'snooze' && !value.snoozed_until) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'snoozed_until is required when snoozing a suggestion',
      path: ['snoozed_until'],
    });
  }
});

export const acceptSuggestionOverridesSchema = z.object({
  title: z.string().trim().min(1).optional(),
  contact_id: z.string().uuid().nullable().optional(),
  owner_id: z.string().uuid().optional(),
  mrr_cents: centsSchema.optional(),
  nrr_cents: centsSchema.optional(),
  hardware_cents: centsSchema.optional(),
  currency_code: z.string().trim().length(3).optional(),
  expected_close_date: expectedCloseDateSchema.nullable().optional(),
  next_action: z.string().trim().min(1).optional(),
  next_action_due: z.string().datetime().optional(),
}).strict();

export const snoozeSuggestionSchema = z.object({
  snoozed_until: z.string().datetime(),
});

export const opportunityListFiltersSchema: z.ZodType<OpportunityListFilters> = z.object({
  status: z.enum(['open', 'won', 'lost', 'all']).optional(),
  stage: opportunityStageSchema.optional(),
  owner_id: z.string().uuid().optional(),
  client_id: z.string().uuid().optional(),
  opportunity_type: opportunityTypeSchema.optional(),
  stalled_only: z.boolean().optional(),
  search: z.string().optional(),
  page: z.number().int().positive().optional(),
  page_size: z.number().int().positive().optional(),
  sort_by: z.enum([
    'next_action_due',
    'expected_close_date',
    'mrr_cents',
    'last_activity_at',
    'created_at',
  ]).optional(),
  sort_direction: z.enum(['asc', 'desc']).optional(),
});
