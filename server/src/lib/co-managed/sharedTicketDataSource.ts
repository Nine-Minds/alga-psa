import type { CoManagedSharedWorkSummary, CoManagedDisplayReference } from '@alga-psa/co-managed';
import type { IComment, CommentAudience } from '@alga-psa/types';
import { nativeTicketDataSource } from '@alga-psa/tickets/lib/nativeTicketDataSource';
import {
  composeTicketDataSource, NO_TICKET_CAPABILITIES, TICKET_SCREEN_FIELDS,
  type TicketDataSource, type TicketDataSourceOverrides,
} from '@alga-psa/tickets/lib/ticketDataSource';

/**
 * The ticket screen's data source for a ticket shared with an MSP technician.
 * It is bound to ONE ticket and is built entirely from the authorized
 * `getCoManagedSharedWorkSummary` result: it never reaches a native
 * ticket-id action (which would read the technician's own tenant).
 *
 * Read-only (`screen.readOnly`), every optional section absent
 * (`NO_TICKET_CAPABILITIES`). Data the summary does not carry (description,
 * people, documents, ...) is the empty shape the seam allows. Any method that
 * would write throws, except conversation writes when a `SharedTicketConversation`
 * is supplied: then the conversation is read and posted through it (every audience
 * through the co-managed writer, since the ticket lives in a foreign tenant) while
 * every ticket field stays frozen.
 */
export class CoManagedReadOnlyTicketError extends Error {
  constructor(group: string, method: string) {
    super(`Shared co-managed tickets are read-only (${group}.${method})`);
    this.name = 'CoManagedReadOnlyTicketError';
  }
}

/** What the screen needs from a loaded shared conversation; `createSharedConversationSession` satisfies it. */
export interface SharedTicketConversation {
  load(): Promise<unknown>;
  comments(): IComment[];
  /** Audiences the viewer may write to; empty means the conversation is read-only. */
  writeAudiences(): readonly CommentAudience[];
  write(message: { content: string; audience: CommentAudience; parentCommentId?: string }): Promise<IComment>;
  /** Audience of an existing comment, for a reply that inherits its thread's audience. */
  audienceOf?(commentId: string): CommentAudience | undefined;
}

const AUDIENCES: readonly string[] = ['requester', 'shared_it', 'organization_private'];
/** Same shape the native actions return for a failure, so the screen's existing handling reports it. */
const actionError = (message: string) => ({ actionError: message }) as never;
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Failed to add comment';

const ref = (value: unknown): CoManagedDisplayReference | null =>
  value && typeof value === 'object' && 'id' in value ? value as CoManagedDisplayReference : null;
const str = (value: unknown) => typeof value === 'string' ? value : undefined;

/** The ITicket-shaped record the screen renders. Absent (redacted) summary fields stay undefined. */
export function sharedTicketRecord(summary: CoManagedSharedWorkSummary) {
  const { fields, resource } = summary;
  const board = ref(fields.board), status = ref(fields.status), priority = ref(fields.priority);
  return {
    tenant: resource.tenant, ticket_id: resource.id,
    ticket_number: str(fields.ticket_number), title: str(fields.title) ?? '',
    board_id: board?.id ?? null, board_name: board?.name ?? undefined,
    status_id: status?.id ?? null, status_name: status?.name ?? undefined,
    is_closed: typeof fields.is_closed === 'boolean' ? fields.is_closed : undefined,
    priority_id: priority?.id ?? null, priority_name: priority?.name ?? undefined,
    entered_at: str(fields.entered_at), updated_at: str(fields.updated_at), closed_at: str(fields.closed_at),
    attributes: {},
    // The creator's attributed display name (a person in the customer's workspace), never an id.
    created_by_display_name: str(fields.opened_by),
  };
}

/** Select options derived from the summary's display references, so the frozen selects can show names. */
export function sharedTicketOptions(summary: CoManagedSharedWorkSummary) {
  const one = (value: unknown, extra: Record<string, unknown> = {}) => {
    const reference = ref(value);
    return reference ? [{ value: reference.id, label: reference.name ?? '', ...extra }] : [];
  };
  return {
    status: one(summary.fields.status, { is_closed: summary.fields.is_closed === true }),
    priority: one(summary.fields.priority), board: one(summary.fields.board), agent: [] as { value: string; label: string }[],
  };
}

type Group = Record<string, (...args: any[]) => unknown>;
const idKeyedGroups = ['ticket', 'comments', 'people', 'resources', 'bundles', 'checklist', 'externalLinks', 'activity', 'email', 'materials', 'tiles', 'tags', 'avatars', 'options'] as const;

/** Every method refuses to write unless the table below names it as a read. */
function group(name: (typeof idKeyedGroups)[number], reads: Group = {}): Group {
  const methods = Object.keys(nativeTicketDataSource[name] as object);
  return Object.fromEntries(methods.map(method => [method, reads[method] ?? (() => { throw new CoManagedReadOnlyTicketError(name, method); })]));
}
const none = async () => [];
const nothing = async () => null;

export function createCoManagedSharedTicketDataSource(summary: CoManagedSharedWorkSummary, backHref: string, conversation?: SharedTicketConversation): TicketDataSource {
  const record = sharedTicketRecord(summary);
  const audiences = conversation?.writeAudiences() ?? [];
  const writable = audiences.length > 0;
  // Fail closed: only an audience the composer offered is written; a missing one is never inferred from `is_internal`.
  const post = async (content: string, audience: unknown, parentCommentId?: string | null) => {
    if (!conversation) throw new CoManagedReadOnlyTicketError('comments', 'create');
    const chosen = typeof audience === 'string' && AUDIENCES.includes(audience) ? audience as CommentAudience
      : parentCommentId ? conversation.audienceOf?.(parentCommentId) : undefined;
    if (!chosen || !audiences.includes(chosen)) throw new Error('Choose who can see this comment before posting it.');
    return conversation.write({ content, audience: chosen, ...(parentCommentId ? { parentCommentId } : {}) });
  };
  const addComment = async (_ticketId: string, content: string, _isInternal: boolean, isResolution?: boolean, _closes?: boolean,
    _suppression?: unknown, schedule?: unknown, _recipients?: unknown, audienceId?: string | null) => {
    // Resolution and scheduling are native-only; the shared command cannot honor them.
    if (isResolution || schedule) return actionError('This comment cannot be posted.');
    try { return await post(content, audienceId); } catch (error) { return actionError(messageOf(error)); }
  };
  const conversationReads: Group = conversation ? {
    findCommentsByTicketId: async () => { await conversation.load(); return conversation.comments(); },
    findCommentById: async (id: string) => conversation.comments().find(comment => comment.comment_id === id) ?? null,
    createComment: async (comment: IComment) => {
      try { return (await post(comment.note ?? '', comment.collaboration_audience, comment.parent_comment_id)).comment_id; } catch (error) { return actionError(messageOf(error)); }
    },
    addTicketCommentWithCache: addComment,
    addTicketCommentWithCacheForCurrentUser: addComment,
  } : {};
  const overrides = {
    kind: 'co-managed-shared',
    boundTicketId: summary.resource.id,
    capabilities: NO_TICKET_CAPABILITIES,
    // Writable only for the conversation: every ticket field is frozen, and the ticket groups below still refuse writes.
    screen: { readOnly: !writable, backHref, ...(writable ? { frozenFields: TICKET_SCREEN_FIELDS } : {}),
      refresh: () => { if (typeof window !== 'undefined') window.location.reload(); } },
    conversation: writable ? { audiences } : {},
    ticket: group('ticket', {
      getTicketById: async (id: string) => id === record.ticket_id ? record : null,
      findBoardById: async () => null, getRecurringSourceForTicket: nothing, getScheduledHoursForTicket: async () => 0,
      getTicketAppointmentRequests: none, getAdjacentTicketIds: async () => ({ previous: null, next: null }),
    }),
    // Without a conversation: no comments, and nothing to react to.
    comments: group('comments', { findCommentsByTicketId: none, findCommentById: nothing, getCommentsReactionsBatch: async () => ({ reactions: {}, userNames: {} }), ...conversationReads }),
    people: group('people', { findUserById: nothing, getAllUsers: none, getAllActiveContacts: none, getContactByContactNameId: nothing,
      getContactsByClient: none, getClientById: nothing, getAllClients: none, getClientLocations: none, getClientBillingProfiles: none }),
    resources: group('resources', { getTicketResources: none, getTeamById: nothing, getTeams: none }),
    options: group('options', { getTicketStatuses: none, getAllPriorities: none, getTicketCategories: none, getTicketCategoriesByBoard: none }),
    bundles: group('bundles'),
    checklist: group('checklist', { getTicketChecklistItems: none, getChecklistTemplates: none }),
    externalLinks: group('externalLinks', { getTicketExternalLinks: none, listExternalSystems: none }),
    activity: group('activity', { getTicketTimelineEntries: none }),
    email: group('email', { getEmailLogsForTicket: none }),
    materials: group('materials', { listTicketMaterials: none }),
    tiles: group('tiles', { getTicketScheduleEntries: none, getTicketInteractions: none, getTicketBillingRollup: nothing,
      getTicketAppointmentRequests: none, getTicketSlaPolicyName: nothing }),
    tags: group('tags', { findTagsByEntityId: none, getTicketPartyDisplayTags: async () => ({ contact: [], client: [] }) }),
    // The owning tenant is foreign: no avatar is ever resolved for it.
    avatars: group('avatars', { getUserAvatarUrlsBatchAction: async () => ({}), getTeamAvatarUrlsBatchAction: async () => ({}), getContactAvatarUrlAction: nothing }),
    time: { fetchTimeEntries: async () => ({ entries: [], ownTotalMinutes: 0, ownEntryCount: 0, othersTotalMinutes: 0, othersEntryCount: 0,
      othersVisibleMinutes: 0, othersVisibleCount: 0, othersHiddenMinutes: 0, othersHiddenCount: 0, totalMinutes: 0 }) },
  };
  return composeTicketDataSource(nativeTicketDataSource, overrides as unknown as TicketDataSourceOverrides);
}
