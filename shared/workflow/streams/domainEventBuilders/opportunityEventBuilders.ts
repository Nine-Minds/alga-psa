import type { OpportunityStage, OpportunityStatus } from '@alga-psa/types';

export const buildOpportunityCreatedPayload = (params: {
  opportunityId: string; clientId: string; ownerId: string; stage: OpportunityStage; createdAt: string;
}) => ({ ...params });

export const buildOpportunityStageChangedPayload = (params: {
  opportunityId: string; clientId: string; previousStage: OpportunityStage; newStage: OpportunityStage; changedAt: string;
}) => ({ ...params });

export const buildOpportunityStatusChangedPayload = (params: {
  opportunityId: string; clientId: string; previousStatus: OpportunityStatus; newStatus: OpportunityStatus; changedAt: string;
}) => ({ ...params });

export const buildOpportunityStalledPayload = (params: {
  opportunityId: string; clientId: string; ownerId: string; daysSinceActivity: number; stalledAt: string;
}) => ({ ...params });

export const buildOpportunityEscalatedPayload = (params: {
  opportunityId: string; clientId: string; ownerId: string; escalatedToUserId?: string; escalatedAt: string;
}) => ({ ...params });

export const buildOpportunityNextActionOverduePayload = (params: {
  opportunityId: string; clientId: string; ownerId: string; nextAction: string; dueAt: string; overdueAt: string;
}) => ({ ...params });

export const buildOpportunitySuggestionCreatedPayload = (params: {
  suggestionId: string; clientId: string; generatorKey: string; createdAt: string;
}) => ({ ...params });

