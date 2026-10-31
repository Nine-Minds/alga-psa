// Registration of the capability resolvers is a side effect of importing
// './capability' and is deliberately NOT re-exported from here.
export * from './provisioning';
export * from './provisioningInvitation';
export * from './acceptance';
export * from './managementPolicy';
export type { CoManagedHomeActor, CoManagedSessionActor } from './sharedWorkIdentity';
export { CoManagedSharedWorkError, isCoManagedSharedWorkError, assertCoManagedSessionUnexpired, isCoManagedUuid,
  snapshotCoManagedSessionActor } from './sharedWorkIdentity';

// Access policy: the single matrix evaluator and policy administration.
export { evaluateCoManagedAccess, effectiveCoManagedGrant, getCoManagedCollaborationPolicy, replaceCoManagedCustomerScope,
  replaceCoManagedStaffAssignments, replaceCoManagedRedactedFields, lockCoManagedCustomerPolicy, CoManagedPolicyError,
  requireCoManagedPolicyReader, listCoManagedLiveSponsoredRelationships, listCoManagedLiveCustomerRelationships } from './policy';
export type { CoManagedAccessFacts, CoManagedAccessDecision, CoManagedAccessLayer, CoManagedDenyReason, CoManagedVisibilityMode,
  CoManagedStaffRole, CoManagedCollaborationPolicy, CoManagedCustomerScope, CoManagedStaffAssignment, CoManagedResourceGrant,
  CoManagedPolicyTarget } from './policy';
// Authorized shared-work read model.
export { withCoManagedSharedWork, withCoManagedAuthenticatedSharedWork, withCoManagedNotificationRecipient, readCoManagedResourceGrant } from './sharedWork';
export type { CoManagedSharedResource, CoManagedSharedWorkContext } from './sharedWork';
export { withCoManagedCustomerTicket, withCoManagedCustomerProject } from './customerWork';
export { getCoManagedSharedWorkSummary, listCoManagedCustomerTickets, visibleCoManagedFields } from './sharedWorkRead';
export type { CoManagedSharedWorkSummary, CoManagedCustomerTicketRow, CoManagedCustomerTicketPage, CoManagedDisplayReference } from './sharedWorkRead';
export { hasEffectiveSharedGrant } from './effectiveSharedGrant';
export { coManagedDisplayName, ensureCoManagedActorReference } from './actorReferences';
export { registerCoManagedAccessReductionRetainer, retainCoManagedBeforeAccessReduction, retainCoManagedParticipationEvidence } from './participationEvidence';
export type { CoManagedAccessReductionContext } from './participationEvidence';
// Delegated administration (board display settings and user profile only).
export { getCoManagedDelegatedScreen, saveCoManagedDelegatedGrant, revokeCoManagedDelegatedGrant, searchCoManagedDelegatedOptions,
  executeCoManagedDelegatedCommand, listCoManagedDelegatedWorkspaces, coManagedDelegatedReceipts, CoManagedDelegationError } from './delegatedAdministration';
export type { CoManagedDelegatedOperation, CoManagedDelegatedTarget, CoManagedDelegatedGrantInput, CoManagedDelegatedCommand } from './delegatedAdministration';
export { coManagedAssigneeOption } from './sharedWorkAssignees';
export { recordCoManagedWorkAudit } from './sharedWorkAudit';
export { withRequesterTaskAccess, withRequesterTaskRecipientAccess } from './requesterTaskAccess';
export { retainCoManagedWorkflowTicketAuthority } from './workflowTicketAuthority';
export { retainCoManagedWorkSnapshot } from './workSnapshotEvidence';
export { retainCoManagedHistoricalWorkEvidence } from './historicalWorkEvidence';
export { hasCoManagedLocalPermission } from './localPermission';
export { loadCoManagedLifecycleFacts, loadCoManagedStaffRoles, loadCoManagedGrantFacts, loadCoManagedHomeFacts } from './sharedWork';
