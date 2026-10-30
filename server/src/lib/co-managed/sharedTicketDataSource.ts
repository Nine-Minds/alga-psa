import type { CoManagedSharedWorkSummary, CoManagedDisplayReference, CoManagedTicketEditField, CoManagedTicketEditPatch,
  CoManagedTicketEditRequest } from '@alga-psa/co-managed';
import { toSharedEditPatch, sharedEditKey } from './sharedTicketMapping';
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
 * Read-only (`screen.readOnly`) unless an {@link CoManagedSharedTicketEdit}
 * capability is injected; every optional section is absent
 * (`NO_TICKET_CAPABILITIES`). Data the summary does not carry (description,
 * people, comments, documents, ...) is the empty shape the seam allows;
 * conversations arrive with L4a. Any method that would write throws, except the
 * ticket update methods, which only ever carry the allowlisted shared edit.
 */
export class CoManagedReadOnlyTicketError extends Error {
  constructor(group: string, method: string) {
    super(`Shared co-managed tickets are read-only (${group}.${method})`);
    this.name = 'CoManagedReadOnlyTicketError';
  }
}

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

/** The result the edit action reports; mirrored here so this module stays free of server-action imports. */
export type SharedTicketEditOutcome = { ok: true } | { ok: false; code: string };

/**
 * The write path of a shared ticket: the fields the caller may edit, their
 * per-field optimistic baselines, and the save command (the
 * `saveSharedTicketEditAction`, which runs the native writer with collaborator
 * guards). The data source owns no authority; it only translates.
 */
export interface CoManagedSharedTicketEdit {
  editableFields: readonly CoManagedTicketEditField[];
  baselines: CoManagedTicketEditPatch;
  save(request: CoManagedTicketEditRequest): Promise<SharedTicketEditOutcome>;
  newOperationId(): string;
  /** Called after a committed save so the screen's baselines follow the saved values. */
  onSaved?(patch: CoManagedTicketEditPatch): void;
}

export class CoManagedSharedTicketEditError extends Error {
  constructor(public readonly code: string) {
    super(`Shared ticket edit was not saved (${code})`);
    this.name = 'CoManagedSharedTicketEditError';
  }
}

/**
 * Builds the `updateTicket*` implementation for a shared ticket. A change the
 * shared model cannot write is refused, never dropped. The operation id is kept
 * per intended edit (baseline + patch), so a retry after `unknownOutcome` replays
 * the exact request and cannot apply twice; any other outcome starts a new edit.
 */
function sharedUpdate(edit: CoManagedSharedTicketEdit, ticketId: string) {
  const pending = new Map<string, string>();
  return async (id: string, changes: Record<string, unknown>) => {
    if (id !== ticketId) throw new CoManagedReadOnlyTicketError('ticket', 'updateTicket');
    const mapped = toSharedEditPatch(changes, edit.editableFields);
    if (!mapped.ok) throw new CoManagedSharedTicketEditError(mapped.code);
    const patch = mapped.patch;
    const expected: Record<string, unknown> = {};
    for (const field of Object.keys(patch)) expected[field] = (edit.baselines as Record<string, unknown>)[field] ?? null;
    const key = sharedEditKey(expected as CoManagedTicketEditPatch, patch);
    const operationId = pending.get(key) ?? edit.newOperationId();
    const result = await edit.save({ operationId, expected: expected as CoManagedTicketEditPatch, patch });
    if (result.ok) {
      pending.delete(key);
      Object.assign(edit.baselines, patch);
      edit.onSaved?.(patch);
      return 'success' as const;
    }
    // Ambiguous commit: keep the request id and baseline for an exact retry, never claim a rollback.
    if (result.code === 'unknownOutcome') pending.set(key, operationId); else pending.delete(key);
    throw new CoManagedSharedTicketEditError(result.code);
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

export function createCoManagedSharedTicketDataSource(summary: CoManagedSharedWorkSummary, backHref: string, edit?: CoManagedSharedTicketEdit): TicketDataSource {
  const record = sharedTicketRecord(summary);
  const update = edit ? sharedUpdate(edit, record.ticket_id) : undefined;
  // LEVERAGE: friction shared-ticket-readonly — `readOnly` conflates "no field edits" with "no composer/reply"; an editable shared screen has to unfreeze fields one by one.
  const screen = edit
    ? { readOnly: false, frozenFields: TICKET_SCREEN_FIELDS.filter(field => !(edit.editableFields as readonly string[]).includes(field)), backHref,
        refresh: () => { if (typeof window !== 'undefined') window.location.reload(); } }
    : { readOnly: true, backHref, refresh: () => { if (typeof window !== 'undefined') window.location.reload(); } };
  const overrides = {
    kind: 'co-managed-shared',
    boundTicketId: summary.resource.id,
    capabilities: NO_TICKET_CAPABILITIES,
    screen,
    ticket: group('ticket', {
      ...(update ? { updateTicket: update, updateTicketWithCache: update, updateTicketWithCacheForCurrentUser: update } : {}),
      getTicketById: async (id: string) => id === record.ticket_id ? record : null,
      findBoardById: async () => null, getRecurringSourceForTicket: nothing, getScheduledHoursForTicket: async () => 0,
      getTicketAppointmentRequests: none, getAdjacentTicketIds: async () => ({ previous: null, next: null }),
    }),
    // Conversations are L4a: no comments yet, and nothing to react to.
    comments: group('comments', { findCommentsByTicketId: none, findCommentById: nothing, getCommentsReactionsBatch: async () => ({}) }),
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
