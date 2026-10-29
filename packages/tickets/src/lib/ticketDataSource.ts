/**
 * TicketDataSource: the seam between the native ticket screen
 * (`TicketDetails` and every section under it) and wherever a ticket's data
 * actually lives.
 *
 * Native tickets resolve every call through today's server actions
 * (`nativeTicketDataSource.ts`). A second implementation (for example a
 * ticket that lives in another tenant) is built in the app /
 * composition layer and injected through `TicketDataSourceProvider`; this
 * package never imports it.
 *
 * Rules for implementers
 * - Methods are plain functions and MUST NOT depend on `this`: components
 *   destructure them (`const { getTicketById } = dataSource.ticket`).
 * - Method names deliberately match the native action they replace, so a
 *   reader can map `dataSource.comments.createComment` to the action and
 *   signatures stay byte-for-byte compatible with the native defaults.
 * - Ticket-scoped methods receive the ticket id as an argument. A bound
 *   implementation (one ticket) ignores it or validates it against
 *   `boundTicketId`; it must never forward a foreign id to a native action.
 * - The `viewer` group is NOT ticket-scoped: it describes the person looking
 *   at the screen (session user, permissions, layout preference, mention
 *   search). Shared implementations delegate it to the local session.
 * - Compose with `composeTicketDataSource(base, overrides)`; a plain
 *   `{...base, ...overrides}` also works but replaces whole groups.
 */
import type React from 'react';
import type { ITicket, TicketTimeEntriesSummary, WorkItemType } from '@alga-psa/types';

// Types only: `typeof` on a type-only import erases at runtime, so this
// module never loads an action. The native implementation owns the runtime
// imports.
import type { getTicketingDisplaySettings } from '../actions/ticketDisplaySettings';
import type { findTagsByEntityId } from '@alga-psa/tags/actions';
import type { findUserById, getCurrentUser, getCurrentUserPermissions, getUserContactId, searchUsersForMentions, getUserAvatarUrlsBatchAction, getContactAvatarUrlAction } from '@alga-psa/user-composition/actions';
import type { getAllUsers } from '@alga-psa/user-composition/actions/userQueryActions';
import type { findBoardById } from '../actions/board-actions/boardActions';
import type {
  findCommentsByTicketId,
  deleteComment,
  createComment,
  updateComment,
  findCommentById,
  cancelScheduledComment,
  rescheduleScheduledComment,
} from '../actions/comment-actions/commentActions';
import type { toggleCommentReaction, getCommentsReactionsBatch } from '../actions/comment-actions/commentReactionActions';
import type { deleteDraftClipboardImages } from '../actions/comment-actions/clipboardImageDraftActions';
import type { discardCommentAttachmentDrafts } from '../actions/comment-actions/commentAttachmentDraftActions';
import type {
  getAllActiveContacts,
  getClientLocations,
  getContactByContactNameId,
  getContactsByClient,
  getClientById,
  getAllClients,
  getClientBillingProfiles,
} from '../actions/clientLookupActions';
import type {
  addTicketCommentWithCache,
  addTicketCommentWithCacheForCurrentUser,
  updateTicketWithCache,
  updateTicketWithCacheForCurrentUser,
  getAdjacentTicketIds,
  getTicketPartyDisplayTags,
} from '../actions/optimizedTicketActions';
import type {
  getTicketById,
  updateTicket,
  deleteTicket,
  getScheduledHoursForTicket,
  getTicketAppointmentRequests as getTicketAppointmentRequestsFromTicketActions,
} from '../actions/ticketActions';
import type { checkTicketClosure, getTicketAutoCloseState } from '../actions/close-rules/closeRuleActions';
import type {
  getTicketChecklistItems,
  addChecklistItem,
  applyChecklistTemplate,
  deleteChecklistItem,
  getChecklistTemplates,
  reorderChecklistItems,
  setChecklistItemCompleted,
  updateChecklistItem,
} from '../actions/checklists';
import type {
  previewBundleStatusPropagationAction,
  addChildrenToBundleAction,
  findTicketByNumberAction,
  getBundleMasterClosedContextAction,
  promoteBundleMasterAction,
  removeChildFromBundleAction,
  unbundleMasterTicketAction,
  updateBundleSettingsAction,
  searchEligibleChildTicketsAction,
} from '../actions/ticketBundleActions';
import type { getTicketStatuses, getAllPriorities } from '@alga-psa/reference-data/actions';
import type { getTicketCategories, getTicketCategoriesByBoard } from '../actions/ticketCategoryActions';
import type { addTicketResource, getTicketResources, removeTicketResource } from '../actions/ticketResourceActions';
import type { assignTeamToTicket, removeTeamFromTicket } from '../actions/teamAssignmentActions';
import type {
  addTicketWatchers,
  setTicketWatcherActive,
  removeTicketWatcher,
} from '../actions/ticketWatcherActions';
import type { getTeamById, getTeams, getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions';
import type { getTicketLayoutPreference, setTicketLayoutPreference } from '../actions/ticketLayoutPreference';
import type { getRecurringSourceForTicket } from '../actions/recurringTicketActions';
import type {
  addExternalLink,
  getTicketExternalLinks,
  listExternalSystems,
  removeExternalLink,
  updateExternalLink,
} from '../actions/externalLinks/externalLinkActions';
import type { getTicketTimelineEntries } from '../actions/ticketActivityActions';
import type { getEmailLogsForTicket } from '@alga-psa/email/actions';
import type {
  listTicketMaterials,
  addTicketMaterial,
  deleteTicketMaterial,
  searchServiceCatalogForPicker,
  getServicePrices,
  listAvailableStockUnitsForMaterial,
} from '../actions/materialCatalogActions';
import type { getProductAvailability } from '@alga-psa/inventory/actions/availabilityActions';
import type {
  getTicketScheduleEntries,
  getTicketInteractions,
  getTicketBillingRollup,
  getTicketAppointmentRequests as getTicketAppointmentRequestsFromBentoActions,
  getTicketSlaPolicyName,
} from '../actions/ticketBentoActions';
import type { preCheckDeletion } from '@alga-psa/auth/lib/preCheckDeletion';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Which backend a data source talks to. `'native'` is the local tenant's
 * ticket tables. Anything else is an app-layer data source and is opaque to
 * this package: sections never branch on it, they branch on capabilities.
 */
export type TicketDataSourceKind = 'native' | (string & {});

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * Which sections and affordances the data source can back. A section whose
 * capability is `false` is ABSENT from the screen (no disabled shell, no
 * placeholder). The existing `hide*` / `isAlgaDeskMode` props still apply on
 * top of these.
 */
export interface TicketCapabilities {
  /** Bundle banners, the bundle master panel, bundle-aware status propagation. */
  bundles: boolean;
  /** The Delete ticket button and its confirmation flow. */
  delete: boolean;
  /** Ticket tags (TagManager) in properties, hero and info. */
  tags: boolean;
  /** Enterprise credentials section. */
  credentials: boolean;
  /** External system links section and the origin link badge lookup. */
  externalLinks: boolean;
  /** Close-rule checklist section, progress chip and auto-close banner. */
  checklist: boolean;
  /** Ticket documents / attachments section and tile. */
  documents: boolean;
  /** Associated assets (the injected `associatedAssets` node). */
  assets: boolean;
  /** Materials card. */
  materials: boolean;
  /** Billing rollup tile and billing profile lookups. */
  billing: boolean;
  /** Quick invoice (the injected `renderQuickInvoice` node). */
  quickInvoice: boolean;
  /** Email notification log drawer. */
  emailLogs: boolean;
  /** Ticket activity log drawer and the timeline's activity feed. */
  activityLog: boolean;
  /** Comment reactions. */
  reactions: boolean;
  /** Live (collaborative) updates: provider mount, presence bar, remote refetch. */
  live: boolean;
  /** Survey summary card. */
  survey: boolean;
  /** Appointment requests section and tile. */
  appointmentRequests: boolean;
  /** Previous / next ticket navigation in the header. */
  navigation: boolean;
  /** Scheduling affordances (schedule work, agent schedule drawer, scheduled hours). */
  scheduling: boolean;
  /** Time entries, stopwatch and the time-logged summary. */
  timeEntry: boolean;
  /** SLA status and clocks. */
  sla: boolean;
  /** Duplicate ticket button. */
  duplicate: boolean;
  /** "Create template from ticket" menu. */
  createTemplate: boolean;
  /** "Create workflow from ticket" menu entry (the injected `renderCreateWorkflowFromTicket` node). */
  createWorkflow: boolean;
  /** Create project task from ticket (the injected `renderCreateProjectTask` node). */
  createProjectTask: boolean;
  /** Creating categories from the ticket screen ("Add new category"). Native-only: needs a board in the local tenant. */
  categoryCreate: boolean;
}

export type TicketCapabilityKey = keyof TicketCapabilities;

/** Every capability on: what a native ticket has today. */
export const NATIVE_TICKET_CAPABILITIES: Readonly<TicketCapabilities> = Object.freeze({
  bundles: true,
  delete: true,
  tags: true,
  credentials: true,
  externalLinks: true,
  checklist: true,
  documents: true,
  assets: true,
  materials: true,
  billing: true,
  quickInvoice: true,
  emailLogs: true,
  activityLog: true,
  reactions: true,
  live: true,
  survey: true,
  appointmentRequests: true,
  navigation: true,
  scheduling: true,
  timeEntry: true,
  sla: true,
  duplicate: true,
  createTemplate: true,
  createWorkflow: true,
  createProjectTask: true,
  categoryCreate: true,
});

/**
 * Capabilities that are nothing but a write (they create, copy or delete), so a
 * read-only screen never offers them. Sections that also display data (documents,
 * checklist, materials, links) stay and read `screen.readOnly` for their own
 * add/edit affordances via `useTicketScreenReadOnly`.
 */
export const TICKET_WRITE_ACTION_CAPABILITIES: readonly TicketCapabilityKey[] = Object.freeze([
  'delete', 'duplicate', 'createTemplate', 'createWorkflow', 'createProjectTask', 'quickInvoice', 'categoryCreate',
] as TicketCapabilityKey[]);

/** Every capability off: a convenient starting point for a reduced data source. */
export const NO_TICKET_CAPABILITIES: Readonly<TicketCapabilities> = Object.freeze(
  Object.fromEntries(
    Object.keys(NATIVE_TICKET_CAPABILITIES).map((key) => [key, false]),
  ) as unknown as TicketCapabilities,
);

// ---------------------------------------------------------------------------
// Screen behaviour (refresh / back navigation)
// ---------------------------------------------------------------------------

/**
 * How the screen refreshes server-rendered data after a write.
 * - `soft`: re-render with fresh server data, keeping client state (native: `router.refresh()`).
 * - `reload`: full page reload (native: `window.location.reload()`).
 */
export type TicketRefreshMode = 'soft' | 'reload';

export interface TicketScreenBehavior {
  /**
   * Overrides how the screen refreshes. Absent (native default) means the
   * previous behaviour exactly: `router.refresh()` for `soft`,
   * `window.location.reload()` for `reload`.
   */
  refresh?: (mode: TicketRefreshMode) => void | Promise<void>;
  /** Where the header "Back to Tickets" control goes. Native: `/msp/tickets`. */
  backHref?: string;
  /**
   * The viewer may look but not write: every field is frozen, the comment
   * composer, reply and edit affordances, the description editor, the
   * additional-agents/team picker and the watch list are absent. Native
   * default: writable (absent / false).
   */
  readOnly?: boolean;
  /**
   * Fields this data source cannot write even for a writer (for example
   * `board_id`). Frozen fields render disabled. Names are the ticket field
   * names plus the section keys in {@link TICKET_SCREEN_FIELDS}.
   */
  frozenFields?: readonly string[];
}

/** Every field / section key a read-only screen freezes. */
export const TICKET_SCREEN_FIELDS: readonly string[] = Object.freeze([
  'title', 'description', 'status_id', 'priority_id', 'category_id', 'subcategory_id', 'board_id',
  'assigned_to', 'due_date', 'response_state', 'client_id', 'contact_name_id', 'location_id',
  'billing_profile_id', 'itil_impact', 'itil_urgency', 'additional_agents', 'watch_list',
]);

/** Frozen field list for the screen: the data source's, plus any live conflicts. */
export function resolveTicketFrozenFields(
  screen: Pick<TicketScreenBehavior, 'readOnly' | 'frozenFields'>,
  extra: readonly string[] = [],
): string[] {
  return [...new Set([...(screen.readOnly ? TICKET_SCREEN_FIELDS : screen.frozenFields ?? []), ...extra])];
}

// ---------------------------------------------------------------------------
// Conversation: editor restrictions
// ---------------------------------------------------------------------------

/**
 * Restrictions for the rich-text editor used by the conversation composer.
 * Native leaves everything unrestricted. All flags default to `false`
 * (allowed); `true` means "disallow".
 */
export interface TicketEditorRestrictions {
  disallowImages?: boolean;
  disallowFiles?: boolean;
  disallowMentions?: boolean;
}

/** Conversation (comment composer) behaviour. Native: `{}`. Extended additively by audience-aware sources. */
export interface TicketConversationConfig {
  editor?: TicketEditorRestrictions;
}

// ---------------------------------------------------------------------------
// Slots and time work
// ---------------------------------------------------------------------------

export type TicketScreenLayout = 'entry' | 'grid';

export interface TicketSlotArgs {
  ticket: ITicket;
  layout: TicketScreenLayout;
  /** Refresh the screen using the data source's refresh behaviour. */
  refresh: () => void;
}

export interface TicketTimeSlotArgs extends TicketSlotArgs {
  /** Bumps whenever a time entry was saved or deleted on this screen. */
  timeEntriesRefreshKey: number;
}

/**
 * App-layer provided sections. Every slot is optional and renders nothing
 * when absent (no placeholder).
 */
export interface TicketScreenSlots {
  /** Rendered in the Entry properties column and as a Grid bento tile. */
  appSection?: (args: TicketSlotArgs) => React.ReactNode;
  /** Rendered next to the time summary (for example an effort split). */
  timeSummary?: (args: TicketTimeSlotArgs) => React.ReactNode;
}

/** The work item a stopwatch / time entry for this ticket is booked against. */
export interface TicketTimeWorkItem {
  workItemType: WorkItemType;
  workItemId: string;
}

export interface TicketTimeConfig {
  /**
   * Resolves the work item for time entry and the stopwatch. Native default:
   * `{ workItemType: 'ticket', workItemId: ticket.ticket_id }`.
   */
  resolveWorkItem?: (ticket: Pick<ITicket, 'ticket_id'>) => TicketTimeWorkItem;
  /**
   * The per-work-item time entries list (and the Time logged tile built on
   * it). Native default: the scheduling callback `fetchTimeEntriesForTicket`.
   * A data source whose time lives on another work item supplies this.
   */
  fetchTimeEntries?: (ticketId: string) => Promise<TicketTimeEntriesSummary>;
}

// ---------------------------------------------------------------------------
// Method groups
// ---------------------------------------------------------------------------

export interface TicketRecordMethods {
  getTicketById: typeof getTicketById;
  updateTicket: typeof updateTicket;
  deleteTicket: typeof deleteTicket;
  /** Delete pre-check (dependency validation) for the single-ticket delete flow. */
  preCheckDeletion: typeof preCheckDeletion;
  updateTicketWithCache: typeof updateTicketWithCache;
  updateTicketWithCacheForCurrentUser: typeof updateTicketWithCacheForCurrentUser;
  getAdjacentTicketIds: typeof getAdjacentTicketIds;
  /** Recurring-origin badge. Not capability gated: return null when the source has no recurring definition. */
  getRecurringSourceForTicket: typeof getRecurringSourceForTicket;
  findBoardById: typeof findBoardById;
  getScheduledHoursForTicket: typeof getScheduledHoursForTicket;
  getTicketAppointmentRequests: typeof getTicketAppointmentRequestsFromTicketActions;
}

export interface TicketCommentMethods {
  findCommentsByTicketId: typeof findCommentsByTicketId;
  findCommentById: typeof findCommentById;
  createComment: typeof createComment;
  updateComment: typeof updateComment;
  deleteComment: typeof deleteComment;
  addTicketCommentWithCache: typeof addTicketCommentWithCache;
  addTicketCommentWithCacheForCurrentUser: typeof addTicketCommentWithCacheForCurrentUser;
  cancelScheduledComment: typeof cancelScheduledComment;
  rescheduleScheduledComment: typeof rescheduleScheduledComment;
  /** Draft clipboard images / attachments created while composing. */
  deleteDraftClipboardImages: typeof deleteDraftClipboardImages;
  discardCommentAttachmentDrafts: typeof discardCommentAttachmentDrafts;
  toggleCommentReaction: typeof toggleCommentReaction;
  getCommentsReactionsBatch: typeof getCommentsReactionsBatch;
}

/** Users, contacts, clients and locations referenced by the ticket. */
export interface TicketPeopleMethods {
  findUserById: typeof findUserById;
  getAllUsers: typeof getAllUsers;
  getAllActiveContacts: typeof getAllActiveContacts;
  getContactByContactNameId: typeof getContactByContactNameId;
  getContactsByClient: typeof getContactsByClient;
  getClientById: typeof getClientById;
  getAllClients: typeof getAllClients;
  getClientLocations: typeof getClientLocations;
  getClientBillingProfiles: typeof getClientBillingProfiles;
}

/** Additional agents and team assignment. */
export interface TicketResourceMethods {
  addTicketResource: typeof addTicketResource;
  getTicketResources: typeof getTicketResources;
  removeTicketResource: typeof removeTicketResource;
  assignTeamToTicket: typeof assignTeamToTicket;
  removeTeamFromTicket: typeof removeTeamFromTicket;
  getTeamById: typeof getTeamById;
  getTeams: typeof getTeams;
}

/**
 * Watch list: contacts, users and bare emails copied on ticket activity.
 * Deliberately NOT part of {@link TicketResourceMethods}: a watcher is never an
 * assigned agent. Writes go through TicketWatcherService, so the screen never
 * rewrites `tickets.attributes` to change watchers.
 */
export interface TicketWatcherMethods {
  addTicketWatchers: typeof addTicketWatchers;
  setTicketWatcherActive: typeof setTicketWatcherActive;
  removeTicketWatcher: typeof removeTicketWatcher;
}

/** Pickable option lists (status, priority, category). */
export interface TicketOptionMethods {
  getTicketStatuses: typeof getTicketStatuses;
  getAllPriorities: typeof getAllPriorities;
  getTicketCategories: typeof getTicketCategories;
  getTicketCategoriesByBoard: typeof getTicketCategoriesByBoard;
}

export interface TicketCloseRuleMethods {
  checkTicketClosure: typeof checkTicketClosure;
  getTicketAutoCloseState: typeof getTicketAutoCloseState;
}

export interface TicketBundleMethods {
  previewBundleStatusPropagationAction: typeof previewBundleStatusPropagationAction;
  addChildrenToBundleAction: typeof addChildrenToBundleAction;
  findTicketByNumberAction: typeof findTicketByNumberAction;
  getBundleMasterClosedContextAction: typeof getBundleMasterClosedContextAction;
  promoteBundleMasterAction: typeof promoteBundleMasterAction;
  removeChildFromBundleAction: typeof removeChildFromBundleAction;
  unbundleMasterTicketAction: typeof unbundleMasterTicketAction;
  updateBundleSettingsAction: typeof updateBundleSettingsAction;
  searchEligibleChildTicketsAction: typeof searchEligibleChildTicketsAction;
}

export interface TicketChecklistMethods {
  getTicketChecklistItems: typeof getTicketChecklistItems;
  addChecklistItem: typeof addChecklistItem;
  applyChecklistTemplate: typeof applyChecklistTemplate;
  deleteChecklistItem: typeof deleteChecklistItem;
  getChecklistTemplates: typeof getChecklistTemplates;
  reorderChecklistItems: typeof reorderChecklistItems;
  setChecklistItemCompleted: typeof setChecklistItemCompleted;
  updateChecklistItem: typeof updateChecklistItem;
}

export interface TicketExternalLinkMethods {
  addExternalLink: typeof addExternalLink;
  getTicketExternalLinks: typeof getTicketExternalLinks;
  listExternalSystems: typeof listExternalSystems;
  removeExternalLink: typeof removeExternalLink;
  updateExternalLink: typeof updateExternalLink;
}

export interface TicketActivityMethods {
  getTicketTimelineEntries: typeof getTicketTimelineEntries;
}

export interface TicketEmailMethods {
  getEmailLogsForTicket: typeof getEmailLogsForTicket;
}

export interface TicketMaterialMethods {
  listTicketMaterials: typeof listTicketMaterials;
  addTicketMaterial: typeof addTicketMaterial;
  deleteTicketMaterial: typeof deleteTicketMaterial;
  searchServiceCatalogForPicker: typeof searchServiceCatalogForPicker;
  getServicePrices: typeof getServicePrices;
  listAvailableStockUnitsForMaterial: typeof listAvailableStockUnitsForMaterial;
  getProductAvailability: typeof getProductAvailability;
}

/** Bento (Grid layout) tile reads. */
export interface TicketTileMethods {
  getTicketScheduleEntries: typeof getTicketScheduleEntries;
  getTicketInteractions: typeof getTicketInteractions;
  getTicketBillingRollup: typeof getTicketBillingRollup;
  getTicketAppointmentRequests: typeof getTicketAppointmentRequestsFromBentoActions;
  getTicketSlaPolicyName: typeof getTicketSlaPolicyName;
}

export interface TicketTagMethods {
  findTagsByEntityId: typeof findTagsByEntityId;
  getTicketPartyDisplayTags: typeof getTicketPartyDisplayTags;
}

/**
 * Avatar reads, `(ids, tenant)`. Callers pass `ticket.tenant`, which for a
 * non-native ticket may be another tenant. The native implementation
 * (`actions/ticketAvatarActions.ts`) ignores any tenant other than the
 * session's and returns no avatars; any other implementation must be equally
 * tenant-safe. The ticket-id guard harness throws from this group so a
 * non-native source has to supply its own.
 */
export interface TicketAvatarMethods {
  getUserAvatarUrlsBatchAction: typeof getUserAvatarUrlsBatchAction;
  getTeamAvatarUrlsBatchAction: typeof getTeamAvatarUrlsBatchAction;
  getContactAvatarUrlAction: typeof getContactAvatarUrlAction;
}

/**
 * VIEWER-SCOPED calls. These describe the person looking at the screen, not
 * the ticket, and are routed through the interface only so tests and shared
 * implementations have one place to see them. Shared implementations delegate
 * them to the local session.
 */
export interface TicketViewerMethods {
  getCurrentUser: typeof getCurrentUser;
  getCurrentUserPermissions: typeof getCurrentUserPermissions;
  getUserContactId: typeof getUserContactId;
  searchUsersForMentions: typeof searchUsersForMentions;
  getTicketLayoutPreference: typeof getTicketLayoutPreference;
  setTicketLayoutPreference: typeof setTicketLayoutPreference;
  getTicketingDisplaySettings: typeof getTicketingDisplaySettings;
}

export interface TicketDataSource {
  readonly kind: TicketDataSourceKind;
  /**
   * The one ticket a bound data source serves. The screen does not read it;
   * it documents the binding, and the implementation's own methods check
   * incoming ids against it.
   */
  readonly boundTicketId?: string;
  readonly capabilities: TicketCapabilities;
  readonly screen: TicketScreenBehavior;
  readonly conversation: TicketConversationConfig;
  readonly slots: TicketScreenSlots;
  readonly time: TicketTimeConfig;

  readonly ticket: TicketRecordMethods;
  readonly comments: TicketCommentMethods;
  readonly people: TicketPeopleMethods;
  readonly resources: TicketResourceMethods;
  readonly watchers: TicketWatcherMethods;
  readonly options: TicketOptionMethods;
  readonly closeRules: TicketCloseRuleMethods;
  readonly bundles: TicketBundleMethods;
  readonly checklist: TicketChecklistMethods;
  readonly externalLinks: TicketExternalLinkMethods;
  readonly activity: TicketActivityMethods;
  readonly email: TicketEmailMethods;
  readonly materials: TicketMaterialMethods;
  readonly tiles: TicketTileMethods;
  readonly tags: TicketTagMethods;
  readonly avatars: TicketAvatarMethods;
  /** Viewer-scoped, see {@link TicketViewerMethods}. */
  readonly viewer: TicketViewerMethods;
}

/** One level of partial: each group may be overridden method by method. */
export type TicketDataSourceOverrides = {
  [K in keyof TicketDataSource]?: TicketDataSource[K] extends object
    ? Partial<TicketDataSource[K]>
    : TicketDataSource[K];
};

/**
 * Builds a data source from a base plus per-group overrides. Groups are
 * merged one level deep, so overriding `comments.createComment` keeps the
 * rest of `comments` from the base. The result is a NEW object: build it once
 * (module level or `useMemo`) and hand the same instance to the provider.
 */
export function composeTicketDataSource(
  base: TicketDataSource,
  overrides: TicketDataSourceOverrides,
): TicketDataSource {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    const baseValue = (base as unknown as Record<string, unknown>)[key];
    const isGroup =
      typeof value === 'object' && value !== null && !Array.isArray(value) &&
      typeof baseValue === 'object' && baseValue !== null;
    merged[key] = isGroup ? { ...(baseValue as object), ...(value as object) } : value;
  }
  // A read-only screen offers no pure-write action, whatever the base allowed.
  if ((merged.screen as TicketScreenBehavior | undefined)?.readOnly) {
    merged.capabilities = {
      ...(merged.capabilities as TicketCapabilities),
      ...Object.fromEntries(TICKET_WRITE_ACTION_CAPABILITIES.map((key) => [key, false])),
    };
  }
  return merged as unknown as TicketDataSource;
}

/** Resolves the work item time is booked against; native default is the ticket itself. */
export function resolveTicketTimeWorkItem(
  dataSource: Pick<TicketDataSource, 'time'>,
  ticket: Pick<ITicket, 'ticket_id'>,
): TicketTimeWorkItem {
  return (
    dataSource.time.resolveWorkItem?.(ticket) ?? {
      workItemType: 'ticket',
      workItemId: ticket.ticket_id ?? '',
    }
  );
}
