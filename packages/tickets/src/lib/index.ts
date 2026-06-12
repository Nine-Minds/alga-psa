export { createTicketColumns } from './ticket-columns';
export { calculateItilPriority, ItilLabels } from './itilUtils';
export { getCommentResponseSource, getLatestCustomerResponseSource } from './responseSource';
export { resolveCommentAuthor } from './commentAuthorResolution';
export {
  convertProseMirrorToTicketRichTextBlocks,
  createEmptyTicketMobileRichTextDocument,
  createTicketRichTextParagraph,
  parseTicketMobileRichTextDocument,
  parseTicketRichTextContent,
  serializeTicketMobileRichTextDocument,
  serializeTicketRichTextContent,
} from './ticketRichText';
export {
  parseTicketMobileEditorNativeToWebMessage,
  parseTicketMobileEditorWebToNativeMessage,
  serializeTicketMobileEditorMessage,
  TicketMobileEditorBridgeClient,
} from './ticketMobileEditorBridge';
export { TicketMobileEditorRuntime } from './ticketMobileEditorRuntime';
export {
  applyVisibilityBoardFilter,
  getClientContactVisibilityContext,
  VISIBILITY_GROUP_MISMATCH_ERROR,
  VISIBILITY_GROUP_MISSING_ERROR,
} from './clientPortalVisibility';
export {
  buildTicketStatusFilterOptions,
  createTicketStatusNameFilterValue,
  isTicketStatusClosedFilter,
  isTicketStatusOpenFilter,
  parseTicketStatusFilterValue,
  shouldApplyOpenOnlyStatusFilter,
  TICKET_STATUS_FILTER_ALL,
  TICKET_STATUS_FILTER_CLOSED,
  TICKET_STATUS_FILTER_OPEN,
} from './ticketStatusFilter';
export type {
  CommentContactAuthor,
  CommentUserAuthor,
  ResolvedCommentAuthor,
} from './commentAuthorResolution';
export type { ContactVisibilityContext } from './clientPortalVisibility';
export type { TicketStatusFilterOption } from './ticketStatusFilter';
export type { TicketMobileEditorBridgeClientOptions } from './ticketMobileEditorBridge';
export type {
  TicketMobileEditorCommand,
  TicketMobileEditorInitPayload,
  TicketMobileEditorNativeToWebMessage,
  TicketMobileEditorRequest,
  TicketMobileEditorStatePayload,
  TicketMobileEditorToolbarState,
  TicketMobileEditorWebToNativeMessage,
  TicketMobileRichTextDocument,
  TicketMobileRichTextFormat,
  TicketMobileRichTextSourceFormat,
  TicketRichTextProseMirrorDoc,
  TicketRichTextProseMirrorMark,
  TicketRichTextProseMirrorNode,
} from './ticketRichText';
export type { TicketMobileEditorRuntimeOptions } from './ticketMobileEditorRuntime';
export { getTicketOrigin, TICKET_ORIGIN_OTHER } from './ticketOrigin';
export type { ResolvedTicketOrigin } from './ticketOrigin';
export { isResponseStateTrackingEnabled } from './responseStateSettings';
// Only the client-safe close-rule types/constants/error are exported from this
// barrel. enforceTicketCloseRules / evaluateTicketCloseRules are server-only
// (they import hasPermission + DB) and must be imported from the deep path
// '@alga-psa/tickets/lib/validateTicketClosure' so they never reach client
// bundles that consume this barrel.
export {
  TicketCloseValidationError,
  CLOSE_RULE_REQUIRED_FIELDS,
  CLOSE_RULE_REQUIRED_FIELD_LABELS,
} from './closeRuleConstants';
export type {
  CloseRuleFailure,
  CloseRuleId,
  CloseRuleBypassSource,
  CloseRuleRequiredField,
  EnforceTicketCloseRulesOptions,
  EnforceTicketCloseRulesResult,
} from './closeRuleConstants';
