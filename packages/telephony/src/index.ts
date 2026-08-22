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
  assertTelephonyAddOn,
  TelephonyAddOnInactiveError,
  tenantHasTelephonyAddOn,
} from './lib/telephonyAddOnGate';
export {
  buildCallInteractionNotes,
  buildCallInteractionTitle,
  CALL_INTERACTION_TYPE_NAME,
  formatDuration,
  resolveCallInteractionTypeId,
  resolveTelephonyActorUserId,
} from './lib/callInteractions';
export { createCallInteraction, ingestCanonicalCall } from './services/ingestCanonicalCall';
export type { IngestCanonicalCallInput, IngestCanonicalCallOutcome } from './services/ingestCanonicalCall';
export { autoCreateTicketForCall } from './services/autoTicketFromCall';
export type { AutoTicketFromCallInput, AutoTicketFromCallOutcome, TicketCreationDefaults } from './services/autoTicketFromCall';
export { resolveCallMatch } from './services/resolveCallMatch';
export type { ResolveCallMatchInput, ResolveCallMatchOutcome } from './services/resolveCallMatch';
