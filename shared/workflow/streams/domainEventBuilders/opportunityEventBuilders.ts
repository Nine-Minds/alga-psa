import { builtWorkflowPayload } from '@alga-psa/event-schemas';
import type { OpportunityStage, OpportunityStatus } from '@alga-psa/types';

export const buildOpportunityCreatedPayload = (params: {
  opportunityId: string; clientId: string; ownerId: string; stage: OpportunityStage; createdAt: string;
}) => builtWorkflowPayload('OPPORTUNITY_CREATED', { ...params });

export const buildOpportunityStageChangedPayload = (params: {
  opportunityId: string; clientId: string; previousStage: OpportunityStage; newStage: OpportunityStage; changedAt: string;
}) => builtWorkflowPayload('OPPORTUNITY_STAGE_CHANGED', { ...params });

export const buildOpportunityStatusChangedPayload = (params: {
  opportunityId: string; clientId: string; previousStatus: OpportunityStatus; newStatus: OpportunityStatus; changedAt: string;
}) => builtWorkflowPayload('OPPORTUNITY_STATUS_CHANGED', { ...params });

export const buildOpportunityStalledPayload = (params: {
  opportunityId: string; clientId: string; ownerId: string; daysSinceActivity: number; stalledAt: string;
}) => builtWorkflowPayload('OPPORTUNITY_STALLED', { ...params });

export const buildOpportunityEscalatedPayload = (params: {
  opportunityId: string; clientId: string; ownerId: string; escalatedToUserId?: string; escalatedAt: string;
}) => builtWorkflowPayload('OPPORTUNITY_ESCALATED', { ...params });

export const buildOpportunityNextActionOverduePayload = (params: {
  opportunityId: string; clientId: string; ownerId: string; nextAction: string; dueAt: string; overdueAt: string;
}) => builtWorkflowPayload('OPPORTUNITY_NEXT_ACTION_OVERDUE', { ...params });

export const buildOpportunitySuggestionCreatedPayload = (params: {
  suggestionId: string; clientId: string; generatorKey: string; createdAt: string;
}) => builtWorkflowPayload('OPPORTUNITY_SUGGESTION_CREATED', { ...params });

