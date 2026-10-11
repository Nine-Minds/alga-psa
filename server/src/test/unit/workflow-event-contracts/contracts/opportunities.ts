import {
  buildOpportunityCreatedPayload,
  buildOpportunityEscalatedPayload,
  buildOpportunityNextActionOverduePayload,
  buildOpportunityStageChangedPayload,
  buildOpportunityStalledPayload,
  buildOpportunityStatusChangedPayload,
  buildOpportunitySuggestionCreatedPayload,
} from '@alga-psa/workflow-streams';
import type { EmitterCase } from '../harness';
import type { EmitterContracts } from '../registryTypes';
import { IDS, NOW, EARLIER } from '../fixtures';

/**
 * Opportunities. Every site goes through publishOpportunityEventAfterCommit with a builder from
 * shared/workflow/streams/domainEventBuilders/opportunityEventBuilders; the publish context carries
 * only the tenant and an occurredAt derived from the payload (no actor).
 */

const ACTIONS = 'packages/opportunities/src/actions/opportunityActions.ts';
const LIB = 'packages/opportunities/src/lib';

type OpportunityEventType =
  | 'OPPORTUNITY_CREATED'
  | 'OPPORTUNITY_STAGE_CHANGED'
  | 'OPPORTUNITY_STATUS_CHANGED'
  | 'OPPORTUNITY_STALLED'
  | 'OPPORTUNITY_ESCALATED'
  | 'OPPORTUNITY_NEXT_ACTION_OVERDUE'
  | 'OPPORTUNITY_SUGGESTION_CREATED';

const opportunity = { opportunityId: IDS.opportunity, clientId: IDS.client, ownerId: IDS.user };
const ctx = { occurredAt: NOW };

const suggestionCase = (generatorKey: 'renewal' | 'tm_conversion' | 'whitespace' | 'asset_aging'): EmitterCase => ({
  site: `${LIB}/generators/runGenerators.ts#runGenerators`,
  ctx,
  build: () =>
    buildOpportunitySuggestionCreatedPayload({ suggestionId: IDS.suggestion, clientId: IDS.client, generatorKey, createdAt: NOW }),
});

export const opportunityContracts = {
  OPPORTUNITY_CREATED: {
    status: 'covered',
    cases: [
      {
        site: `${ACTIONS}#createOpportunity`,
        ctx,
        build: () => buildOpportunityCreatedPayload({ ...opportunity, stage: 'identified', createdAt: NOW }),
      },
      {
        site: `${LIB}/suggestions.ts#acceptSuggestionInternal`,
        ctx,
        build: () => buildOpportunityCreatedPayload({ ...opportunity, stage: 'qualified', createdAt: NOW }),
      },
    ],
  },
  OPPORTUNITY_STAGE_CHANGED: {
    status: 'covered',
    cases: [
      {
        site: `${ACTIONS}#closeOpportunity`,
        ctx,
        build: () =>
          buildOpportunityStageChangedPayload({
            opportunityId: IDS.opportunity,
            clientId: IDS.client,
            previousStage: 'proposed',
            newStage: 'won',
            changedAt: NOW,
          }),
      },
      {
        site: `${LIB}/stageEngine.ts#updateDerivedStage`,
        ctx,
        build: () =>
          buildOpportunityStageChangedPayload({
            opportunityId: IDS.opportunity,
            clientId: IDS.client,
            previousStage: 'identified',
            newStage: 'qualified',
            changedAt: NOW,
          }),
      },
    ],
  },
  OPPORTUNITY_STATUS_CHANGED: {
    status: 'covered',
    cases: [
      {
        site: `${ACTIONS}#closeOpportunity`,
        ctx,
        build: () =>
          buildOpportunityStatusChangedPayload({
            opportunityId: IDS.opportunity,
            clientId: IDS.client,
            previousStatus: 'open',
            newStatus: 'lost',
            changedAt: NOW,
          }),
      },
    ],
  },
  OPPORTUNITY_STALLED: {
    status: 'covered',
    cases: [
      {
        site: `${LIB}/disciplineEngine.ts#runOpportunityDiscipline`,
        ctx,
        build: () => buildOpportunityStalledPayload({ ...opportunity, daysSinceActivity: 14, stalledAt: NOW }),
      },
    ],
  },
  OPPORTUNITY_ESCALATED: {
    status: 'covered',
    cases: [
      {
        site: `${LIB}/disciplineEngine.ts#runOpportunityDiscipline`,
        ctx,
        build: () => buildOpportunityEscalatedPayload({ ...opportunity, escalatedToUserId: IDS.assignee, escalatedAt: NOW }),
      },
      {
        // solo escalation mode: the owner is also the escalation target.
        site: `${LIB}/disciplineEngine.ts#runOpportunityDiscipline`,
        ctx,
        build: () => buildOpportunityEscalatedPayload({ ...opportunity, escalatedToUserId: IDS.user, escalatedAt: NOW }),
      },
    ],
  },
  OPPORTUNITY_NEXT_ACTION_OVERDUE: {
    status: 'covered',
    cases: [
      {
        site: `${LIB}/disciplineEngine.ts#runOpportunityDiscipline`,
        ctx,
        build: () =>
          buildOpportunityNextActionOverduePayload({
            ...opportunity,
            nextAction: 'Send renewal quote',
            dueAt: EARLIER,
            overdueAt: NOW,
          }),
      },
    ],
  },
  OPPORTUNITY_SUGGESTION_CREATED: {
    status: 'covered',
    cases: [suggestionCase('renewal'), suggestionCase('tm_conversion'), suggestionCase('whitespace'), suggestionCase('asset_aging')],
  },
} satisfies Pick<EmitterContracts, OpportunityEventType>;
