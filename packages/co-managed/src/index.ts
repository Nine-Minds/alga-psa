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
export { withRequesterTaskAccess, withRequesterTaskRecipientAccess, listRequesterSharedTaskIds } from './requesterTaskAccess';
export { requesterSharedTaskIds, isRequesterTaskSharedWork } from './requesterSharedWork';
export { retainCoManagedWorkflowTicketAuthority } from './workflowTicketAuthority';
export { retainCoManagedWorkSnapshot } from './workSnapshotEvidence';
export { retainCoManagedHistoricalWorkEvidence } from './historicalWorkEvidence';
export { hasCoManagedLocalPermission } from './localPermission';
export { loadCoManagedLifecycleFacts, loadCoManagedStaffRoles, loadCoManagedGrantFacts, loadCoManagedHomeFacts } from './sharedWork';
export { CO_MANAGED_TASK_RESOURCE_ALIASES, isCoManagedTaskResourceHidden } from './sharedWorkProjection';
export { projectCoManagedNotificationSnapshot } from './sharedWorkProjection';
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
// L3d: the native project screen's one-project read, and task -> project location.
export { getCoManagedSharedProjectScreen, locateCoManagedSharedTask, coManagedHiddenTaskFields, CO_MANAGED_SCREEN_TASK_FIELDS } from './projectScreenRead';
export type { CoManagedSharedProjectScreen, CoManagedSharedProjectScreenTask, CoManagedSharedProjectScreenPhase, CoManagedSharedProjectScreenStatus } from './projectScreenRead';
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
export { readCoManagedSlaPolicyScreen, replaceCoManagedSlaPriorityMappings } from './slaPriorityMappings';
export type { CoManagedSlaPolicyScreen, CoManagedSlaPriorityMapping } from './slaPriorityMappings';
export { withCoManagedSlaNotification, fanoutCoManagedSlaNotification } from './slaNotification';
export type { CoManagedSlaNotification, CoManagedSlaNotificationChannel } from './slaNotification';
export { withCoManagedStoredSlaNotification } from './storedSlaNotification';
export type { CoManagedStoredSlaNotification } from './storedSlaNotification';
export { enqueueCoManagedSlaDeliveries, pendingCoManagedSlaDeliveries, flagStaleCoManagedSlaSending, SLA_STALE_SENDING_MS, SLA_IN_APP_KIND, SLA_EMAIL_KIND } from './slaDeliveries';
export type { CoManagedSlaDeliveryRow, CoManagedSlaDeliveryPayload } from './slaDeliveries';
export { observeDueCoManagedTicketSlas } from './ticketSla';
export { getCoManagedTicketSlaDisplay, type CoManagedTicketSlaDisplay, type CoManagedSlaDisplay, type CoManagedSlaTargetDisplay } from './ticketSlaRead';
// L4b: attachments, drafts, thread disclosure, archive files.
export * from './attachmentParent';
export * from './attachmentStoragePath';
export * from './conversationAttachments';
export * from './conversationDrafts';
export * from './uploadCleanup';
export * from './archiveFiles';
export * from './attachmentExport';
export * from './threadDisclosure';
export * from './privateThreadDisclosure';
export * from './privateThreadTransferCleanup';
// Time, effort and billing modes (L6a2).
export * from './effortTotals';
export * from './timeEntryBillingMode';
export * from './timeWorkItem';
export type { CoManagedLocalWorkReference, CoManagedWorkSourceKind } from './timeWorkReference';
export { findCoManagedLocalWorkReference, loadCoManagedLocalWorkReference, recordCoManagedWorkReference } from './timeWorkReference';
export { retainCoManagedTimeParticipation } from './timeParticipationEvidence';
export * from './timeBillingProfile';
// L7a: departure, closure and the participation-evidence-only MSP archive.
export { closeCoManagedRelationship, endCoManagedSponsorshipsForDeletion, releaseCoManagedSeatsForCustomerDeletion, CoManagedClosureError } from './relationshipClosure';
export type { CoManagedClosureRequest, CoManagedClosureReceipt, CoManagedClosureContext } from './relationshipClosure';
export { getCoManagedDepartureScreen, departCoManagedRelationship } from './departure';
export type { CoManagedDepartureQualifiedTarget, CoManagedDepartureReview, CoManagedDepartureRequest } from './departure';
export { sealCoManagedArchive, classifyArchiveCandidate, coManagedArchiveManifestHash, registerCoManagedArchiveFileSource,
  ARCHIVE_EVIDENCE_CLASSES, ARCHIVE_ALLOWED_AUDIENCES } from './archiveManifest';
export type { CoManagedArchiveManifest, CoManagedArchiveFileSource, CoManagedArchiveFileContent } from './archiveManifest';
export { finalizeCoManagedArchive, registerCoManagedClosureEvidenceSource } from './archiveFinalization';
export { listCoManagedArchives, getCoManagedArchiveHistory, readCoManagedArchiveFile } from './archiveReads';
export type { CoManagedArchiveSummary, CoManagedArchiveEntry, CoManagedArchiveFile, CoManagedArchiveHistory } from './archiveReads';

export * from './portableRestoreUploads';
export { assertPortableRestoreInstallationAuthority } from './portableRestoreInstallationAuthority';
// Independent upgrade (CM L8b): customer-owned purchase, screen and the receipt-idempotent transition.
export { upgradeCoManagedRelationship, prepareCoManagedIndependentUpgrade, CoManagedIndependentUpgradeError } from './independentUpgrade';
export type { CoManagedIndependentUpgradeRequest, CoManagedIndependentUpgradeCommand, CoManagedIndependentEntitlement,
  CoManagedIndependentUpgradeReceipt } from './independentUpgrade';
export type { CoManagedUpgradeClosure } from './upgradeClosure';
export { coManagedUpgradeClosure } from './upgradeClosureWiring';
export { getCoManagedIndependentUpgradeScreen, resolveCoManagedUpgradeAccess, type CoManagedUpgradeAccess } from './independentUpgradeScreen';
export { prepareCoManagedUpgradePurchase, withCoManagedUpgradePurchaseAdmin, CO_MANAGED_UPGRADE_PURCHASE_STATES,
  CO_MANAGED_UPGRADE_PENDING_STATES } from './upgradePurchase';
export type { CoManagedUpgradePurchase, CoManagedUpgradePurchaseRequest, CoManagedUpgradePurchaseState } from './upgradePurchase';
// Seat shape (S5): seat arrangements and their board scope.
export * from './seatArrangement';
// Seat shape (S8): the role a seat technician holds, seeded by the sponsor's first arrangement.
export * from './seatRole';
// Seat shape (S14): the people a seat technician can see.
export * from './seatPeopleProjection';
// Seat shape (S7): inviting a technician against the arrangement's allocation.
export * from './seatInvitation';
// Seat shape (S23): ticket responsibility and the handoff in each direction.
export * from './seatTicketHandoff';
// Seat shape (S32): who a handoff and a shared IT note notify.
export * from './seatNotifications';
