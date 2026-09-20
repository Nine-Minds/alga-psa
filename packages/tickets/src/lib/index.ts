export { createTicketColumns } from './ticket-columns';
export {
  hashString,
  statusPillHue,
  relativeDueLabel,
  formatDuePrimary,
  daysUntil,
  formatCategoryLabel,
  STATUS_PILL_HUES,
  STATUS_PILL_CLOSED_HUE,
} from './ticketListPresentation';
export {
  TICKET_COLUMNS,
  TOGGLEABLE_TICKET_COLUMNS,
  resolveTicketColumnVisibility,
  resolveTicketColumnOrder,
} from './ticketColumnCatalog';
export type { TicketColumnSpec, TicketColumnKind, TicketListColumnKey } from './ticketColumnCatalog';
export {
  CAPTURE_EXCLUDED_FILTER_KEYS,
  TICKET_VIEW_DENSITY_DEFAULT,
  TICKET_VIEW_DENSITY_STEP,
  buildBoardArrivalFilters,
  captureTicketViewSettings,
  resolveTicketViewSettings,
  ticketViewDiffersFromSaved,
  validateCapturedFilters,
} from './ticketViewSettings';
export type {
  CaptureExcludedFilterKey,
  ResolvedTicketViewSettings,
  TicketViewSettings,
} from './ticketViewSettings';
export {
  DEFAULT_TICKET_LIST_PRESENTATION,
  NATIVE_TICKET_LIST_SCOPE,
  TICKET_LIST_CLIENT_PARAM,
  TICKET_LIST_DEFAULT_PAGE,
  TICKET_LIST_DEFAULT_PAGE_SIZE,
  TICKET_LIST_DIRECTION_PARAM,
  TICKET_LIST_MAX_PAGE_SIZE,
  TICKET_LIST_MAX_SEARCH_LENGTH,
  TICKET_LIST_MIN_PAGE_SIZE,
  TICKET_LIST_PAGE_PARAM,
  TICKET_LIST_PAGE_SIZE_PARAM,
  TICKET_LIST_QUEUE_VIEW_PARAM,
  TICKET_LIST_SEARCH_PARAM,
  TICKET_LIST_SORT_PARAM,
  TICKET_LIST_STATE_PARAM,
  TICKET_LIST_WORKSPACE_PARAM,
  buildTicketListHref,
  hasExplicitQualifiedScope,
  isQualifiedTicketListScope,
  isTicketQueueDirection,
  isTicketQueueSort,
  isTicketQueueState,
  normalizeTicketListPage,
  normalizeTicketListPageSize,
  parseTicketListPresentation,
  parseTicketListScope,
  resetQualifiedTicketListPresentation,
  serializeTicketListQuery,
  switchTicketListView,
  ticketListScopesEqual,
  ticketListWorkspaceToken,
} from './ticketListScope';
export type {
  NativeTicketListScope,
  QualifiedTicketListScope,
  TicketListPresentation,
  TicketListScope,
  TicketListWorkspace,
  TicketQueueDirection,
  TicketQueueSort,
  TicketQueueState,
  TicketQueueView,
} from './ticketListScope';
export {
  isQualifiedHandbackEligible,
  isSharedTicketListIdentity,
  nativeTicketListIdentity,
  sharedTicketListIdentity,
  ticketListDetailHref,
  ticketListIdentityFromQueueItem,
  ticketListIdentityKey,
} from './ticketListIdentity';
export type { TicketListIdentity, TicketListIdentitySource } from './ticketListIdentity';
export { calculateItilPriority, ItilLabels } from './itilUtils';
export { getCommentResponseSource, getLatestCustomerResponseSource } from './responseSource';
export { resolveCommentAuthor } from './commentAuthorResolution';
export {
  convertProseMirrorToTicketRichTextBlocks,
  createEmptyTicketMobileRichTextDocument,
  createTicketRichTextParagraph,
  extractTicketRichTextPlainText,
  parseTicketMobileRichTextDocument,
  parseTicketRichTextContent,
  serializeTicketMobileRichTextDocument,
  serializeTicketRichTextContent,
} from './ticketRichText';
export { extractTicketRichTextHtml } from './ticketRichTextHtml';
export {
  parseTicketMobileEditorNativeToWebMessage,
  parseTicketMobileEditorWebToNativeMessage,
  serializeTicketMobileEditorMessage,
  TicketMobileEditorBridgeClient,
} from './ticketMobileEditorBridge';
export { TicketMobileEditorRuntime } from './ticketMobileEditorRuntime';
export {
  applyTicketVisibilityFilter,
  VISIBILITY_GROUP_MISMATCH_ERROR,
  VISIBILITY_GROUP_MISSING_ERROR,
} from './clientPortalVisibility';
// getClientContactVisibilityContext is server-only because it imports the DB
// facade. Import it from './clientPortalVisibility.server' in server actions.
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
export {
  isBuiltInExternalSystemKey,
  isCustomExternalSystemKey,
  findBuiltInExternalSystem,
  customExternalSystemToDefinition,
  resolveExternalSystem,
  listExternalSystems,
  safeExternalUrl,
  isValidExternalUrl,
  renderExternalLinkUrl,
  resolveExternalSystemOrigin,
} from './externalSystems';
export { resolveDocumentViewUrl, documentViewUrl } from './documentViewUrl';
export type { DocumentViewUrlInput } from './documentViewUrl';
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
export {
  BundlePropagationConfirmationRequiredError,
} from './ticketBundlePropagation';
export type {
  TicketBundleBoundary,
  BundlePropagationChild,
  BundlePropagationUnaffectedReason,
  BundlePropagationUnaffectedChild,
  BundleStatusPropagationPreview,
  BundlePropagationUser,
  BundleStatusPropagationContext,
  PropagateBundleMasterStatusOptions,
  PropagateBundleMasterStatusResult,
} from './ticketBundlePropagation';
