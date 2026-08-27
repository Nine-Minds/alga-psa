export * from './types';
export {
  formatCallNumber,
  normalizeToE164,
  phoneMatchCandidates,
  stripExtension,
  toDigits,
} from './lib/phoneNumbers';
export { auditContactPhoneNormalization, matchCallParty } from './lib/callMatching';
export {
  assertTelephonyEntitlement,
  TelephonyEntitlementInactiveError,
  tenantHasTelephonyEntitlement,
} from './lib/telephonyAddOnGate';
export {
  buildCallInteractionNotes,
  buildCallInteractionTitle,
  CALL_INTERACTION_TYPE_NAME,
  formatDuration,
  resolveCallInteractionTypeId,
  resolveTelephonyActorUserId,
} from './lib/callInteractions';
export {
  callArtifactFetchIntervalMs,
  hasCallArtifactWindowElapsed,
  isCallArtifactFetchDue,
} from './lib/callArtifactBackoff';
export { createCallTranscriptDocument } from './lib/callArtifactDocuments';
export type { CreateCallTranscriptDocumentInput } from './lib/callArtifactDocuments';
export { captureCallArtifacts, listCallsAwaitingArtifacts } from './services/captureCallArtifacts';
export type {
  CallArtifactCaptureSettings,
  CaptureCallArtifactsDependencies,
  CaptureCallArtifactsInput,
  CaptureCallArtifactsOutcome,
} from './services/captureCallArtifacts';
export {
  createCallInteraction,
  ingestCanonicalCall,
  resolveTenantPhoneCountryCode,
} from './services/ingestCanonicalCall';
export type { IngestCanonicalCallInput, IngestCanonicalCallOutcome } from './services/ingestCanonicalCall';
export { autoCreateTicketForCall } from './services/autoTicketFromCall';
export type { AutoTicketFromCallInput, AutoTicketFromCallOutcome, TicketCreationDefaults } from './services/autoTicketFromCall';
export { resolveCallMatch } from './services/resolveCallMatch';
export type { ResolveCallMatchInput, ResolveCallMatchOutcome } from './services/resolveCallMatch';
