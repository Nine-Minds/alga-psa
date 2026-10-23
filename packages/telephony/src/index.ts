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
  buildCallInteractionNotes,
  buildCallInteractionTitle,
  CALL_INTERACTION_TYPE_NAME,
  CHAT_INTERACTION_TYPE_NAME,
  formatDuration,
  resolveCallInteractionTypeId,
  resolveChatInteractionTypeId,
  resolveTelephonyActorUserId,
} from './lib/callInteractions';
export {
  callArtifactFetchIntervalMs,
  hasCallArtifactWindowElapsed,
  isCallArtifactFetchDue,
} from './lib/callArtifactBackoff';
export {
  appendCallSummaryToInteraction,
  createCallTranscriptDocument,
  resolveCallDocumentOwner,
} from './lib/callArtifactDocuments';
export type { CreateCallTranscriptDocumentInput } from './lib/callArtifactDocuments';
export { attachProvidedTranscript } from './services/attachProvidedTranscript';
export type {
  AttachProvidedTranscriptInput,
  AttachProvidedTranscriptOutcome,
} from './services/attachProvidedTranscript';
export { captureCallArtifacts, listCallsAwaitingArtifacts } from './services/captureCallArtifacts';
export type {
  CallArtifactCaptureSettings,
  CallArtifactProviderFetcher,
  CallArtifactProviderFetchResult,
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
export { buildChatInteractionTitle, createChatInteraction, ingestChat } from './services/ingestChat';
export type { ChatInteractionSource, CreateChatInteractionInput, IngestChatInput, IngestChatOutcome } from './services/ingestChat';
export { resolveChatMatch } from './services/resolveChatMatch';
export type { ResolveChatMatchInput, ResolveChatMatchOutcome } from './services/resolveChatMatch';
export { listUnattributedChats } from './services/listTelephonyChats';
export type { ListUnattributedChatsInput } from './services/listTelephonyChats';
