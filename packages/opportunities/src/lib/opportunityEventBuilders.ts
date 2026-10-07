// Deliberately the shared subpath, not the '@alga-psa/workflow-streams' root
// barrel: that package's "." export points at dist/index.mjs, which no build
// ever produces, so the root barrel is unresolvable under plain Node (the
// workflow-worker runtime that dynamically imports runGenerators).
export {
  buildOpportunityCreatedPayload,
  buildOpportunityEscalatedPayload,
  buildOpportunityNextActionOverduePayload,
  buildOpportunityStageChangedPayload,
  buildOpportunityStalledPayload,
  buildOpportunityStatusChangedPayload,
  buildOpportunitySuggestionCreatedPayload,
} from '@alga-psa/shared/workflow/streams/domainEventBuilders/opportunityEventBuilders';
