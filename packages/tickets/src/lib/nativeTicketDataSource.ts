/**
 * The native TicketDataSource: today's server actions, unchanged.
 *
 * Every entry is a LAZY wrapper (`lazy(ticketActionsModule, 'getTicketById')`),
 * not the action itself, for three reasons:
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
 *
 * Each action module has exactly one loader (`actionModule`), shared by every
 * method it backs, so calls made while that module is still loading wait on the
 * one in-flight import instead of each starting their own.
 */
import {
  NATIVE_TICKET_CAPABILITIES,
  type TicketDataSource,
} from './ticketDataSource';

/**
 * A loader for one action module. Concurrent calls share the single in-flight
 * import; once it settles the next call imports again (a cache hit in the
 * module system), so the export is still read at call time (reason 1 above).
 *
 * Starting a second import of a module whose first import has not yet settled
 * is not safe under the vitest module runner: the second import can bypass a
 * `vi.mock` of the specifier and evaluate the real module, pulling its whole
 * server graph (db, auth, authorization) into a component test. Two ticket
 * screens mounting together trigger exactly that.
 */
const actionModule = <M>(load: () => Promise<M>): (() => Promise<M>) => {
  let inFlight: Promise<M> | undefined;
  return () => {
    if (!inFlight) {
      const pending = load();
      inFlight = pending;
      const settle = () => {
        if (inFlight === pending) inFlight = undefined;
      };
      pending.then(settle, settle);
    }
    return inFlight;
  };
};

/** Loads the action module on first call, then forwards the call. */
// LEVERAGE: pattern late-bound-action-forwarder - every native method is a forwarder to one action; a codegen'd or table-driven forwarder would replace ~100 wrapper lines
const lazy = <M extends Record<string, any>, K extends keyof M & string>(
  load: () => Promise<M>,
  key: K,
): M[K] =>
  (async (...args: unknown[]) => (await load())[key](...args)) as unknown as M[K];

// One loader per action module, shared by every method that module backs. Module specifiers stay literal so
// `vi.mock` of each specifier still intercepts.
const ticketActionsModule = actionModule(() => import('../actions/ticketActions'));
const authLibPreCheckDeletionModule = actionModule(() => import('@alga-psa/auth/lib/preCheckDeletion'));
const optimizedTicketActionsModule = actionModule(() => import('../actions/optimizedTicketActions'));
const recurringTicketActionsModule = actionModule(() => import('../actions/recurringTicketActions'));
const boardActionsBoardActionsModule = actionModule(() => import('../actions/board-actions/boardActions'));
const commentActionsCommentActionsModule = actionModule(() => import('../actions/comment-actions/commentActions'));
const commentActionsClipboardImageDraftActionsModule = actionModule(() => import('../actions/comment-actions/clipboardImageDraftActions'));
const commentActionsCommentAttachmentDraftActionsModule = actionModule(() => import('../actions/comment-actions/commentAttachmentDraftActions'));
const commentActionsCommentReactionActionsModule = actionModule(() => import('../actions/comment-actions/commentReactionActions'));
const userCompositionActionsModule = actionModule(() => import('@alga-psa/user-composition/actions'));
const userCompositionActionsUserQueryActionsModule = actionModule(() => import('@alga-psa/user-composition/actions/userQueryActions'));
const clientLookupActionsModule = actionModule(() => import('../actions/clientLookupActions'));
const ticketResourceActionsModule = actionModule(() => import('../actions/ticketResourceActions'));
const teamAssignmentActionsModule = actionModule(() => import('../actions/teamAssignmentActions'));
const teamsActionsModule = actionModule(() => import('@alga-psa/teams/actions'));
const ticketWatcherActionsModule = actionModule(() => import('../actions/ticketWatcherActions'));
const referenceDataActionsModule = actionModule(() => import('@alga-psa/reference-data/actions'));
const ticketCategoryActionsModule = actionModule(() => import('../actions/ticketCategoryActions'));
const closeRulesCloseRuleActionsModule = actionModule(() => import('../actions/close-rules/closeRuleActions'));
const ticketBundleActionsModule = actionModule(() => import('../actions/ticketBundleActions'));
const checklistsTicketChecklistActionsModule = actionModule(() => import('../actions/checklists/ticketChecklistActions'));
const checklistsModule = actionModule(() => import('../actions/checklists'));
const externalLinksExternalLinkActionsModule = actionModule(() => import('../actions/externalLinks/externalLinkActions'));
const ticketActivityActionsModule = actionModule(() => import('../actions/ticketActivityActions'));
const emailActionsModule = actionModule(() => import('@alga-psa/email/actions'));
const materialCatalogActionsModule = actionModule(() => import('../actions/materialCatalogActions'));
const inventoryActionsAvailabilityActionsModule = actionModule(() => import('@alga-psa/inventory/actions/availabilityActions'));
const ticketBentoActionsModule = actionModule(() => import('../actions/ticketBentoActions'));
const tagsActionsModule = actionModule(() => import('@alga-psa/tags/actions'));
const ticketAvatarActionsModule = actionModule(() => import('../actions/ticketAvatarActions'));
const ticketLayoutPreferenceModule = actionModule(() => import('../actions/ticketLayoutPreference'));
const ticketDisplaySettingsModule = actionModule(() => import('../actions/ticketDisplaySettings'));

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
    getTicketById: lazy(ticketActionsModule, 'getTicketById'),
    updateTicket: lazy(ticketActionsModule, 'updateTicket'),
    deleteTicket: lazy(ticketActionsModule, 'deleteTicket'),
    preCheckDeletion: lazy(authLibPreCheckDeletionModule, 'preCheckDeletion'),
    updateTicketWithCache: lazy(optimizedTicketActionsModule, 'updateTicketWithCache'),
    updateTicketWithCacheForCurrentUser: lazy(optimizedTicketActionsModule, 'updateTicketWithCacheForCurrentUser'),
    getAdjacentTicketIds: lazy(optimizedTicketActionsModule, 'getAdjacentTicketIds'),
    getRecurringSourceForTicket: lazy(recurringTicketActionsModule, 'getRecurringSourceForTicket'),
    findBoardById: lazy(boardActionsBoardActionsModule, 'findBoardById'),
    getScheduledHoursForTicket: lazy(ticketActionsModule, 'getScheduledHoursForTicket'),
    getTicketAppointmentRequests: lazy(ticketActionsModule, 'getTicketAppointmentRequests'),
  }),

  comments: Object.freeze({
    findCommentsByTicketId: lazy(commentActionsCommentActionsModule, 'findCommentsByTicketId'),
    findCommentById: lazy(commentActionsCommentActionsModule, 'findCommentById'),
    createComment: lazy(commentActionsCommentActionsModule, 'createComment'),
    updateComment: lazy(commentActionsCommentActionsModule, 'updateComment'),
    deleteComment: lazy(commentActionsCommentActionsModule, 'deleteComment'),
    addTicketCommentWithCache: lazy(optimizedTicketActionsModule, 'addTicketCommentWithCache'),
    addTicketCommentWithCacheForCurrentUser: lazy(optimizedTicketActionsModule, 'addTicketCommentWithCacheForCurrentUser'),
    cancelScheduledComment: lazy(commentActionsCommentActionsModule, 'cancelScheduledComment'),
    rescheduleScheduledComment: lazy(commentActionsCommentActionsModule, 'rescheduleScheduledComment'),
    deleteDraftClipboardImages: lazy(commentActionsClipboardImageDraftActionsModule, 'deleteDraftClipboardImages'),
    discardCommentAttachmentDrafts: lazy(commentActionsCommentAttachmentDraftActionsModule, 'discardCommentAttachmentDrafts'),
    toggleCommentReaction: lazy(commentActionsCommentReactionActionsModule, 'toggleCommentReaction'),
    getCommentsReactionsBatch: lazy(commentActionsCommentReactionActionsModule, 'getCommentsReactionsBatch'),
  }),

  people: Object.freeze({
    findUserById: lazy(userCompositionActionsModule, 'findUserById'),
    getAllUsers: lazy(userCompositionActionsUserQueryActionsModule, 'getAllUsers'),
    getAllActiveContacts: lazy(clientLookupActionsModule, 'getAllActiveContacts'),
    getContactByContactNameId: lazy(clientLookupActionsModule, 'getContactByContactNameId'),
    getContactsByClient: lazy(clientLookupActionsModule, 'getContactsByClient'),
    getClientById: lazy(clientLookupActionsModule, 'getClientById'),
    getAllClients: lazy(clientLookupActionsModule, 'getAllClients'),
    getClientLocations: lazy(clientLookupActionsModule, 'getClientLocations'),
    getClientBillingProfiles: lazy(clientLookupActionsModule, 'getClientBillingProfiles'),
    getContactEffectiveLocation: lazy(clientLookupActionsModule, 'getContactEffectiveLocation'),
    searchClientsForPicker: lazy(clientLookupActionsModule, 'searchClientsForPicker'),
  }),

  resources: Object.freeze({
    addTicketResource: lazy(ticketResourceActionsModule, 'addTicketResource'),
    getTicketResources: lazy(ticketResourceActionsModule, 'getTicketResources'),
    removeTicketResource: lazy(ticketResourceActionsModule, 'removeTicketResource'),
    assignTeamToTicket: lazy(teamAssignmentActionsModule, 'assignTeamToTicket'),
    removeTeamFromTicket: lazy(teamAssignmentActionsModule, 'removeTeamFromTicket'),
    getTeamById: lazy(teamsActionsModule, 'getTeamById'),
    getTeams: lazy(teamsActionsModule, 'getTeams'),
  }),

  watchers: Object.freeze({
    addTicketWatchers: lazy(ticketWatcherActionsModule, 'addTicketWatchers'),
    setTicketWatcherActive: lazy(ticketWatcherActionsModule, 'setTicketWatcherActive'),
    removeTicketWatcher: lazy(ticketWatcherActionsModule, 'removeTicketWatcher'),
  }),

  options: Object.freeze({
    getTicketStatuses: lazy(referenceDataActionsModule, 'getTicketStatuses'),
    getAllPriorities: lazy(referenceDataActionsModule, 'getAllPriorities'),
    getTicketCategories: lazy(ticketCategoryActionsModule, 'getTicketCategories'),
    getTicketCategoriesByBoard: lazy(ticketCategoryActionsModule, 'getTicketCategoriesByBoard'),
  }),

  closeRules: Object.freeze({
    checkTicketClosure: lazy(closeRulesCloseRuleActionsModule, 'checkTicketClosure'),
    getTicketAutoCloseState: lazy(closeRulesCloseRuleActionsModule, 'getTicketAutoCloseState'),
  }),

  bundles: Object.freeze({
    previewBundleStatusPropagationAction: lazy(ticketBundleActionsModule, 'previewBundleStatusPropagationAction'),
    addChildrenToBundleAction: lazy(ticketBundleActionsModule, 'addChildrenToBundleAction'),
    findTicketByNumberAction: lazy(ticketBundleActionsModule, 'findTicketByNumberAction'),
    getBundleMasterClosedContextAction: lazy(ticketBundleActionsModule, 'getBundleMasterClosedContextAction'),
    promoteBundleMasterAction: lazy(ticketBundleActionsModule, 'promoteBundleMasterAction'),
    removeChildFromBundleAction: lazy(ticketBundleActionsModule, 'removeChildFromBundleAction'),
    unbundleMasterTicketAction: lazy(ticketBundleActionsModule, 'unbundleMasterTicketAction'),
    updateBundleSettingsAction: lazy(ticketBundleActionsModule, 'updateBundleSettingsAction'),
    searchEligibleChildTicketsAction: lazy(ticketBundleActionsModule, 'searchEligibleChildTicketsAction'),
  }),

  checklist: Object.freeze({
    getTicketChecklistItems: lazy(checklistsTicketChecklistActionsModule, 'getTicketChecklistItems'),
    addChecklistItem: lazy(checklistsModule, 'addChecklistItem'),
    applyChecklistTemplate: lazy(checklistsModule, 'applyChecklistTemplate'),
    deleteChecklistItem: lazy(checklistsModule, 'deleteChecklistItem'),
    getChecklistTemplates: lazy(checklistsModule, 'getChecklistTemplates'),
    getChecklistTemplatesForTicket: lazy(checklistsModule, 'getChecklistTemplatesForTicket'),
    reorderChecklistItems: lazy(checklistsModule, 'reorderChecklistItems'),
    setChecklistItemCompleted: lazy(checklistsModule, 'setChecklistItemCompleted'),
    updateChecklistItem: lazy(checklistsModule, 'updateChecklistItem'),
  }),

  externalLinks: Object.freeze({
    addExternalLink: lazy(externalLinksExternalLinkActionsModule, 'addExternalLink'),
    getTicketExternalLinks: lazy(externalLinksExternalLinkActionsModule, 'getTicketExternalLinks'),
    listExternalSystems: lazy(externalLinksExternalLinkActionsModule, 'listExternalSystems'),
    removeExternalLink: lazy(externalLinksExternalLinkActionsModule, 'removeExternalLink'),
    updateExternalLink: lazy(externalLinksExternalLinkActionsModule, 'updateExternalLink'),
  }),

  activity: Object.freeze({
    getTicketTimelineEntries: lazy(ticketActivityActionsModule, 'getTicketTimelineEntries'),
  }),

  email: Object.freeze({
    getEmailLogsForTicket: lazy(emailActionsModule, 'getEmailLogsForTicket'),
  }),

  materials: Object.freeze({
    listTicketMaterials: lazy(materialCatalogActionsModule, 'listTicketMaterials'),
    addTicketMaterial: lazy(materialCatalogActionsModule, 'addTicketMaterial'),
    deleteTicketMaterial: lazy(materialCatalogActionsModule, 'deleteTicketMaterial'),
    searchServiceCatalogForPicker: lazy(materialCatalogActionsModule, 'searchServiceCatalogForPicker'),
    getServicePrices: lazy(materialCatalogActionsModule, 'getServicePrices'),
    listAvailableStockUnitsForMaterial: lazy(materialCatalogActionsModule, 'listAvailableStockUnitsForMaterial'),
    getProductAvailability: lazy(inventoryActionsAvailabilityActionsModule, 'getProductAvailability'),
  }),

  tiles: Object.freeze({
    getTicketScheduleEntries: lazy(ticketBentoActionsModule, 'getTicketScheduleEntries'),
    getTicketInteractions: lazy(ticketBentoActionsModule, 'getTicketInteractions'),
    getTicketBillingRollup: lazy(ticketBentoActionsModule, 'getTicketBillingRollup'),
    getTicketAppointmentRequests: lazy(ticketBentoActionsModule, 'getTicketAppointmentRequests'),
    getTicketSlaPolicyName: lazy(ticketBentoActionsModule, 'getTicketSlaPolicyName'),
  }),

  tags: Object.freeze({
    findTagsByEntityId: lazy(tagsActionsModule, 'findTagsByEntityId'),
    getTicketPartyDisplayTags: lazy(optimizedTicketActionsModule, 'getTicketPartyDisplayTags'),
  }),

  avatars: Object.freeze({
    // Session-tenant checked: a ticket from another tenant gets no avatars.
    getUserAvatarUrlsBatchAction: lazy(ticketAvatarActionsModule, 'getTicketUserAvatarUrlsBatch'),
    getTeamAvatarUrlsBatchAction: lazy(ticketAvatarActionsModule, 'getTicketTeamAvatarUrlsBatch'),
    getContactAvatarUrlAction: lazy(ticketAvatarActionsModule, 'getTicketContactAvatarUrl'),
  }),

  viewer: Object.freeze({
    getCurrentUser: lazy(userCompositionActionsModule, 'getCurrentUser'),
    getCurrentUserPermissions: lazy(userCompositionActionsModule, 'getCurrentUserPermissions'),
    getUserContactId: lazy(userCompositionActionsModule, 'getUserContactId'),
    searchUsersForMentions: lazy(userCompositionActionsModule, 'searchUsersForMentions'),
    getTicketLayoutPreference: lazy(ticketLayoutPreferenceModule, 'getTicketLayoutPreference'),
    setTicketLayoutPreference: lazy(ticketLayoutPreferenceModule, 'setTicketLayoutPreference'),
    getTicketingDisplaySettings: lazy(ticketDisplaySettingsModule, 'getTicketingDisplaySettings'),
  }),
}) as TicketDataSource;
