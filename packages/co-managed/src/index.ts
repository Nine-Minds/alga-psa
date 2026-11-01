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
export { evaluateCoManagedAccess, coManagedRelationshipAllowsWrite, effectiveCoManagedGrant, getCoManagedCollaborationPolicy, replaceCoManagedCustomerScope,
  replaceCoManagedStaffAssignments, replaceCoManagedRedactedFields, lockCoManagedCustomerPolicy, CoManagedPolicyError,
  requireCoManagedPolicyReader, listCoManagedLiveSponsoredRelationships } from './policy';
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
export { CO_MANAGED_TASK_RESOURCE_ALIASES, isCoManagedTaskResourceHidden } from './sharedWorkProjection';
export { listCoManagedSharedProjects, listCoManagedSharedProjectTasks } from './projectTaskQueue';
export type { CoManagedSharedProjectRow, CoManagedSharedProjectPage, CoManagedSharedTaskRow, CoManagedSharedTaskPage } from './projectTaskQueue';
export { editCoManagedProjectTask, getCoManagedProjectTaskSnapshot, CoManagedTaskEditError, CO_MANAGED_TASK_EDIT_FIELDS } from './projectTaskEditing';
export type { CoManagedTaskEditRequest, CoManagedTaskEditReceipt, CoManagedTaskSnapshot, CoManagedTaskWriter, CoManagedTaskEditPatch } from './projectTaskEditing';
export { assignCoManagedProjectTask } from './projectTaskAssignments';
export type { CoManagedTaskAssignmentRequest, CoManagedTaskAssignmentReceipt } from './projectTaskAssignments';
export { admitCoManagedNativeTaskCommentAccess, CO_MANAGED_TASK_LOCATOR_PAGE } from './nativeTaskCommentAccess';
export type { CoManagedNativeTaskCommentAccess, CoManagedTaskLocator } from './nativeTaskCommentAccess';
export { listCoManagedAssignedTasks } from './projectTaskQueue';
export type { CoManagedAssignedTaskRow, CoManagedAssignedTaskPage } from './projectTaskQueue';
export { listCoManagedProjectTaskHistory } from './projectTaskAudit';
export type { CoManagedTaskHistoryEntry } from './projectTaskAudit';
export { countCoManagedNativeTaskComments } from './nativeTaskCommentAccess';
export { listCoManagedProjectTaskStatusOptions } from './projectTaskEditing';
export type { CoManagedProjectTaskStatusOption } from './projectTaskEditing';
// L3b1: shared ticket handoff engine, Working queue and shared-ticket write path.
export * from './ticketHandoffs';
export * from './ticketQueue';
export * from './ticketEditing';
export * from './ticketAssignments';
export * from './ticketBulkHandback';
export * from './ticketCollaboration';
export * from './sharedTicketDetails';

// Conversation audiences, private threads and shared-ticket comment commands (L4a).
export { createCoManagedTicketComment, CoManagedCommentCreateError } from './ticketCommentCreation';
export type { CoManagedCommentReference, CoManagedCommentCreateRequest, CoManagedCommentCreateReceipt, CoManagedCommentCreateContext, CoManagedCommentInsert } from './ticketCommentCreation';
export { mutateCoManagedTicketComment, CoManagedCommentMutationError } from './ticketCommentMutation';
export type { CoManagedCommentMutationRequest, CoManagedCommentMutationReceipt, CoManagedCommentMutationContext, CoManagedCommentMutation } from './ticketCommentMutation';
export { mutateCoManagedPrivateTicketComment, mutateCoManagedPrivateTaskComment, CoManagedPrivateCommentError } from './privateTicketConversation';
export type { CoManagedPrivateCommentReference, CoManagedPrivateCommentCommand, CoManagedPrivateCommentReceipt } from './privateTicketConversation';
export { getCoManagedTicketConversation, getCoManagedConversationContributionHints, getCoManagedConversationWriteAudiences } from './ticketConversation';
export { localAuthorReference, LOCAL_AUTHOR_REFERENCE_NAMESPACE } from './conversationAuthorReference';
export type { CoManagedConversationCursor, CoManagedConversationItem, CoManagedConversationAuthor, CoManagedTicketConversation } from './ticketConversation';
export { retainCoManagedConversationParticipation, retainCoManagedSharedConversationBeforeReduction } from './conversationParticipationEvidence';
export type { CoManagedCaptureIntent, CoManagedConversationCapture } from './conversationParticipationEvidence';
export { retainCoManagedPrivateParticipation, retainCoManagedPrivateHistoryAtClosure } from './privateParticipationEvidence';
// Importing this module registers the conversation access-reduction retainer.
export { retainCoManagedConversationBeforeSourceChange } from './sourceChangeRetention';
export { snapshotConversationContent, encodeConversationContent, plainTextContent } from './conversationContent';
export type { CoManagedConversationContent } from './conversationContent';
export { projectTaskAudience, projectTaskAudienceSql } from './projectTaskAudience';
