import { z } from 'zod';
import { BaseDomainEventPayloadSchema, uuidSchema } from './commonEventPayloadSchemas';

const opportunityIdSchema = uuidSchema('Opportunity ID');
const clientIdSchema = uuidSchema('Client ID');
const userIdSchema = uuidSchema('User ID');
const suggestionIdSchema = uuidSchema('Suggestion ID');

const opportunityStageSchema = z.enum([
  'identified',
  'qualified',
  'assessment',
  'proposed',
  'verbal',
  'won',
  'lost',
]);

const opportunityStatusSchema = z.enum(['open', 'won', 'lost']);
const opportunityGeneratorKeySchema = z.enum(['renewal', 'tm_conversion', 'whitespace', 'asset_aging']);

export const opportunityCreatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  opportunityId: opportunityIdSchema,
  clientId: clientIdSchema,
  ownerId: userIdSchema,
  stage: opportunityStageSchema,
  createdAt: z.string().datetime(),
}).describe('Payload for OPPORTUNITY_CREATED');

export const opportunityStageChangedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  opportunityId: opportunityIdSchema,
  clientId: clientIdSchema,
  previousStage: opportunityStageSchema,
  newStage: opportunityStageSchema,
  changedAt: z.string().datetime(),
}).describe('Payload for OPPORTUNITY_STAGE_CHANGED');

export const opportunityStatusChangedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  opportunityId: opportunityIdSchema,
  clientId: clientIdSchema,
  previousStatus: opportunityStatusSchema,
  newStatus: opportunityStatusSchema,
  changedAt: z.string().datetime(),
}).describe('Payload for OPPORTUNITY_STATUS_CHANGED');

export const opportunityStalledEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  opportunityId: opportunityIdSchema,
  clientId: clientIdSchema,
  ownerId: userIdSchema,
  daysSinceActivity: z.number().int().nonnegative(),
  stalledAt: z.string().datetime(),
}).describe('Payload for OPPORTUNITY_STALLED');

export const opportunityEscalatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  opportunityId: opportunityIdSchema,
  clientId: clientIdSchema,
  ownerId: userIdSchema,
  escalatedToUserId: userIdSchema.optional(),
  escalatedAt: z.string().datetime(),
}).describe('Payload for OPPORTUNITY_ESCALATED');

export const opportunityNextActionOverdueEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  opportunityId: opportunityIdSchema,
  clientId: clientIdSchema,
  ownerId: userIdSchema,
  nextAction: z.string().min(1),
  dueAt: z.string().datetime(),
  overdueAt: z.string().datetime(),
}).describe('Payload for OPPORTUNITY_NEXT_ACTION_OVERDUE');

export const opportunitySuggestionCreatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  suggestionId: suggestionIdSchema,
  clientId: clientIdSchema,
  generatorKey: opportunityGeneratorKeySchema,
  createdAt: z.string().datetime(),
}).describe('Payload for OPPORTUNITY_SUGGESTION_CREATED');

export type OpportunityCreatedEventPayload = z.infer<typeof opportunityCreatedEventPayloadSchema>;
export type OpportunityStageChangedEventPayload = z.infer<typeof opportunityStageChangedEventPayloadSchema>;
export type OpportunityStatusChangedEventPayload = z.infer<typeof opportunityStatusChangedEventPayloadSchema>;
export type OpportunityStalledEventPayload = z.infer<typeof opportunityStalledEventPayloadSchema>;
export type OpportunityEscalatedEventPayload = z.infer<typeof opportunityEscalatedEventPayloadSchema>;
export type OpportunityNextActionOverdueEventPayload = z.infer<typeof opportunityNextActionOverdueEventPayloadSchema>;
export type OpportunitySuggestionCreatedEventPayload = z.infer<typeof opportunitySuggestionCreatedEventPayloadSchema>;
