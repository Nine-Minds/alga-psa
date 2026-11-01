/**
 * The native TicketDataSource: today's server actions, unchanged.
 *
 * Every entry is a LAZY wrapper (`lazy(() => import('...'), 'action')`), not
 * the action itself, for three reasons:
 * 1. Module mocks (`vi.mock('../../actions/...')`) that export only a subset
 *    of an action module keep working: the export is read when the method is
 *    called, exactly as the components did when they imported it directly.
 * 2. This object is built once at module level and must not throw while the
 *    module graph is still loading.
 * 3. Importing the seam must not pull every action module (and their server
 *    dependencies) into every component that merely reads the context; a
 *    component only loads the actions it actually calls.
 *
 * Module specifiers below are the ones the ticket components imported before
 * the seam existed, so existing mocks of those specifiers still intercept.
 */
import {
  NATIVE_TICKET_CAPABILITIES,
  type TicketDataSource,
} from './ticketDataSource';

/** Loads the action module on first call, then forwards the call. */
// LEVERAGE: pattern late-bound-action-forwarder - every native method is a forwarder to one action; a codegen'd or table-driven forwarder would replace ~100 wrapper lines
const lazy = <M extends Record<string, any>, K extends keyof M & string>(
  load: () => Promise<M>,
  key: K,
): M[K] =>
  (async (...args: unknown[]) => (await load())[key](...args)) as unknown as M[K];

/**
 * Stable module-level singleton. Never recreate it per render: components put
 * its methods in effect and callback dependency lists.
 */
export const nativeTicketDataSource: TicketDataSource = Object.freeze({
  kind: 'native',
  capabilities: NATIVE_TICKET_CAPABILITIES,
  screen: Object.freeze({}),
  conversation: Object.freeze({}),
  slots: Object.freeze({}),
  time: Object.freeze({}),

  ticket: Object.freeze({
    getTicketById: lazy(() => import('../actions/ticketActions'), 'getTicketById'),
    updateTicket: lazy(() => import('../actions/ticketActions'), 'updateTicket'),
    deleteTicket: lazy(() => import('../actions/ticketActions'), 'deleteTicket'),
    preCheckDeletion: lazy(() => import('@alga-psa/auth/lib/preCheckDeletion'), 'preCheckDeletion'),
    updateTicketWithCache: lazy(() => import('../actions/optimizedTicketActions'), 'updateTicketWithCache'),
    updateTicketWithCacheForCurrentUser: lazy(() => import('../actions/optimizedTicketActions'), 'updateTicketWithCacheForCurrentUser'),
    getAdjacentTicketIds: lazy(() => import('../actions/optimizedTicketActions'), 'getAdjacentTicketIds'),
    getRecurringSourceForTicket: lazy(() => import('../actions/recurringTicketActions'), 'getRecurringSourceForTicket'),
    findBoardById: lazy(() => import('../actions/board-actions/boardActions'), 'findBoardById'),
    getScheduledHoursForTicket: lazy(() => import('../actions/ticketActions'), 'getScheduledHoursForTicket'),
    getTicketAppointmentRequests: lazy(() => import('../actions/ticketActions'), 'getTicketAppointmentRequests'),
  }),

  comments: Object.freeze({
    findCommentsByTicketId: lazy(() => import('../actions/comment-actions/commentActions'), 'findCommentsByTicketId'),
    findCommentById: lazy(() => import('../actions/comment-actions/commentActions'), 'findCommentById'),
    createComment: lazy(() => import('../actions/comment-actions/commentActions'), 'createComment'),
    updateComment: lazy(() => import('../actions/comment-actions/commentActions'), 'updateComment'),
    deleteComment: lazy(() => import('../actions/comment-actions/commentActions'), 'deleteComment'),
    addTicketCommentWithCache: lazy(() => import('../actions/optimizedTicketActions'), 'addTicketCommentWithCache'),
    addTicketCommentWithCacheForCurrentUser: lazy(() => import('../actions/optimizedTicketActions'), 'addTicketCommentWithCacheForCurrentUser'),
    cancelScheduledComment: lazy(() => import('../actions/comment-actions/commentActions'), 'cancelScheduledComment'),
    rescheduleScheduledComment: lazy(() => import('../actions/comment-actions/commentActions'), 'rescheduleScheduledComment'),
    deleteDraftClipboardImages: lazy(() => import('../actions/comment-actions/clipboardImageDraftActions'), 'deleteDraftClipboardImages'),
    discardCommentAttachmentDrafts: lazy(() => import('../actions/comment-actions/commentAttachmentDraftActions'), 'discardCommentAttachmentDrafts'),
    toggleCommentReaction: lazy(() => import('../actions/comment-actions/commentReactionActions'), 'toggleCommentReaction'),
    getCommentsReactionsBatch: lazy(() => import('../actions/comment-actions/commentReactionActions'), 'getCommentsReactionsBatch'),
  }),

  people: Object.freeze({
    findUserById: lazy(() => import('@alga-psa/user-composition/actions'), 'findUserById'),
    getAllUsers: lazy(() => import('@alga-psa/user-composition/actions/userQueryActions'), 'getAllUsers'),
    getAllActiveContacts: lazy(() => import('../actions/clientLookupActions'), 'getAllActiveContacts'),
    getContactByContactNameId: lazy(() => import('../actions/clientLookupActions'), 'getContactByContactNameId'),
    getContactsByClient: lazy(() => import('../actions/clientLookupActions'), 'getContactsByClient'),
    getClientById: lazy(() => import('../actions/clientLookupActions'), 'getClientById'),
    getAllClients: lazy(() => import('../actions/clientLookupActions'), 'getAllClients'),
    getClientLocations: lazy(() => import('../actions/clientLookupActions'), 'getClientLocations'),
    getClientBillingProfiles: lazy(() => import('../actions/clientLookupActions'), 'getClientBillingProfiles'),
  }),

  resources: Object.freeze({
    addTicketResource: lazy(() => import('../actions/ticketResourceActions'), 'addTicketResource'),
    getTicketResources: lazy(() => import('../actions/ticketResourceActions'), 'getTicketResources'),
    removeTicketResource: lazy(() => import('../actions/ticketResourceActions'), 'removeTicketResource'),
    assignTeamToTicket: lazy(() => import('../actions/teamAssignmentActions'), 'assignTeamToTicket'),
    removeTeamFromTicket: lazy(() => import('../actions/teamAssignmentActions'), 'removeTeamFromTicket'),
    getTeamById: lazy(() => import('@alga-psa/teams/actions'), 'getTeamById'),
    getTeams: lazy(() => import('@alga-psa/teams/actions'), 'getTeams'),
  }),

  watchers: Object.freeze({
    addTicketWatchers: lazy(() => import('../actions/ticketWatcherActions'), 'addTicketWatchers'),
    setTicketWatcherActive: lazy(() => import('../actions/ticketWatcherActions'), 'setTicketWatcherActive'),
    removeTicketWatcher: lazy(() => import('../actions/ticketWatcherActions'), 'removeTicketWatcher'),
  }),

  options: Object.freeze({
    getTicketStatuses: lazy(() => import('@alga-psa/reference-data/actions'), 'getTicketStatuses'),
    getAllPriorities: lazy(() => import('@alga-psa/reference-data/actions'), 'getAllPriorities'),
    getTicketCategories: lazy(() => import('../actions/ticketCategoryActions'), 'getTicketCategories'),
    getTicketCategoriesByBoard: lazy(() => import('../actions/ticketCategoryActions'), 'getTicketCategoriesByBoard'),
  }),

  closeRules: Object.freeze({
    checkTicketClosure: lazy(() => import('../actions/close-rules/closeRuleActions'), 'checkTicketClosure'),
    getTicketAutoCloseState: lazy(() => import('../actions/close-rules/closeRuleActions'), 'getTicketAutoCloseState'),
  }),

  bundles: Object.freeze({
    previewBundleStatusPropagationAction: lazy(() => import('../actions/ticketBundleActions'), 'previewBundleStatusPropagationAction'),
    addChildrenToBundleAction: lazy(() => import('../actions/ticketBundleActions'), 'addChildrenToBundleAction'),
    findTicketByNumberAction: lazy(() => import('../actions/ticketBundleActions'), 'findTicketByNumberAction'),
    getBundleMasterClosedContextAction: lazy(() => import('../actions/ticketBundleActions'), 'getBundleMasterClosedContextAction'),
    promoteBundleMasterAction: lazy(() => import('../actions/ticketBundleActions'), 'promoteBundleMasterAction'),
    removeChildFromBundleAction: lazy(() => import('../actions/ticketBundleActions'), 'removeChildFromBundleAction'),
    unbundleMasterTicketAction: lazy(() => import('../actions/ticketBundleActions'), 'unbundleMasterTicketAction'),
    updateBundleSettingsAction: lazy(() => import('../actions/ticketBundleActions'), 'updateBundleSettingsAction'),
    searchEligibleChildTicketsAction: lazy(() => import('../actions/ticketBundleActions'), 'searchEligibleChildTicketsAction'),
  }),

  checklist: Object.freeze({
    getTicketChecklistItems: lazy(() => import('../actions/checklists/ticketChecklistActions'), 'getTicketChecklistItems'),
    addChecklistItem: lazy(() => import('../actions/checklists'), 'addChecklistItem'),
    applyChecklistTemplate: lazy(() => import('../actions/checklists'), 'applyChecklistTemplate'),
    deleteChecklistItem: lazy(() => import('../actions/checklists'), 'deleteChecklistItem'),
    getChecklistTemplates: lazy(() => import('../actions/checklists'), 'getChecklistTemplates'),
    reorderChecklistItems: lazy(() => import('../actions/checklists'), 'reorderChecklistItems'),
    setChecklistItemCompleted: lazy(() => import('../actions/checklists'), 'setChecklistItemCompleted'),
    updateChecklistItem: lazy(() => import('../actions/checklists'), 'updateChecklistItem'),
  }),

  externalLinks: Object.freeze({
    addExternalLink: lazy(() => import('../actions/externalLinks/externalLinkActions'), 'addExternalLink'),
    getTicketExternalLinks: lazy(() => import('../actions/externalLinks/externalLinkActions'), 'getTicketExternalLinks'),
    listExternalSystems: lazy(() => import('../actions/externalLinks/externalLinkActions'), 'listExternalSystems'),
    removeExternalLink: lazy(() => import('../actions/externalLinks/externalLinkActions'), 'removeExternalLink'),
    updateExternalLink: lazy(() => import('../actions/externalLinks/externalLinkActions'), 'updateExternalLink'),
  }),

  activity: Object.freeze({
    getTicketTimelineEntries: lazy(() => import('../actions/ticketActivityActions'), 'getTicketTimelineEntries'),
  }),

  email: Object.freeze({
    getEmailLogsForTicket: lazy(() => import('@alga-psa/email/actions'), 'getEmailLogsForTicket'),
  }),

  materials: Object.freeze({
    listTicketMaterials: lazy(() => import('../actions/materialCatalogActions'), 'listTicketMaterials'),
    addTicketMaterial: lazy(() => import('../actions/materialCatalogActions'), 'addTicketMaterial'),
    deleteTicketMaterial: lazy(() => import('../actions/materialCatalogActions'), 'deleteTicketMaterial'),
    searchServiceCatalogForPicker: lazy(() => import('../actions/materialCatalogActions'), 'searchServiceCatalogForPicker'),
    getServicePrices: lazy(() => import('../actions/materialCatalogActions'), 'getServicePrices'),
    listAvailableStockUnitsForMaterial: lazy(() => import('../actions/materialCatalogActions'), 'listAvailableStockUnitsForMaterial'),
    getProductAvailability: lazy(() => import('@alga-psa/inventory/actions/availabilityActions'), 'getProductAvailability'),
  }),

  tiles: Object.freeze({
    getTicketScheduleEntries: lazy(() => import('../actions/ticketBentoActions'), 'getTicketScheduleEntries'),
    getTicketInteractions: lazy(() => import('../actions/ticketBentoActions'), 'getTicketInteractions'),
    getTicketBillingRollup: lazy(() => import('../actions/ticketBentoActions'), 'getTicketBillingRollup'),
    getTicketAppointmentRequests: lazy(() => import('../actions/ticketBentoActions'), 'getTicketAppointmentRequests'),
    getTicketSlaPolicyName: lazy(() => import('../actions/ticketBentoActions'), 'getTicketSlaPolicyName'),
  }),

  tags: Object.freeze({
    findTagsByEntityId: lazy(() => import('@alga-psa/tags/actions'), 'findTagsByEntityId'),
    getTicketPartyDisplayTags: lazy(() => import('../actions/optimizedTicketActions'), 'getTicketPartyDisplayTags'),
  }),

  avatars: Object.freeze({
    // Session-tenant checked: a ticket from another tenant gets no avatars.
    getUserAvatarUrlsBatchAction: lazy(() => import('../actions/ticketAvatarActions'), 'getTicketUserAvatarUrlsBatch'),
    getTeamAvatarUrlsBatchAction: lazy(() => import('../actions/ticketAvatarActions'), 'getTicketTeamAvatarUrlsBatch'),
    getContactAvatarUrlAction: lazy(() => import('../actions/ticketAvatarActions'), 'getTicketContactAvatarUrl'),
  }),

  viewer: Object.freeze({
    getCurrentUser: lazy(() => import('@alga-psa/user-composition/actions'), 'getCurrentUser'),
    getCurrentUserPermissions: lazy(() => import('@alga-psa/user-composition/actions'), 'getCurrentUserPermissions'),
    getUserContactId: lazy(() => import('@alga-psa/user-composition/actions'), 'getUserContactId'),
    searchUsersForMentions: lazy(() => import('@alga-psa/user-composition/actions'), 'searchUsersForMentions'),
    getTicketLayoutPreference: lazy(() => import('../actions/ticketLayoutPreference'), 'getTicketLayoutPreference'),
    setTicketLayoutPreference: lazy(() => import('../actions/ticketLayoutPreference'), 'setTicketLayoutPreference'),
    getTicketingDisplaySettings: lazy(() => import('../actions/ticketDisplaySettings'), 'getTicketingDisplaySettings'),
  }),
}) as TicketDataSource;
