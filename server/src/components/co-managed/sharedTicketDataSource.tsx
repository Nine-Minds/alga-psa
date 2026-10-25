'use client';

import React from 'react';
import type { IComment } from '@alga-psa/types';
import type { CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import type { CoManagedSharedResource, CoManagedTicketEditPatch, CoManagedTicketEditField } from '@alga-psa/co-managed';
import {
  composeTicketDataSource,
  NO_TICKET_CAPABILITIES,
  TICKET_SCREEN_FIELDS,
  type TicketCapabilities,
  type TicketDataSource,
  type TicketDataSourceOverrides,
  type TicketRefreshMode,
  type TicketTimeConfig,
} from '@alga-psa/tickets/lib/ticketDataSource';
import { nativeTicketDataSource } from '@alga-psa/tickets/lib/nativeTicketDataSource';
import { conversationDocument } from './conversationText';
import { newCoManagedOperationId } from './coManagedOperationId';
import { createTicketCommentWriter, TicketCommentWriteError } from './ticketCommentWriter';
import CoManagedTicketSection from './CoManagedTicketSection';
import CoManagedEffortSummary from './CoManagedEffortSummary';
import SharedCommentAttachmentPicker from './SharedCommentAttachmentPicker';
import { createAttachmentStaging, type AttachmentStaging } from '@/lib/co-managed/attachmentStaging';
import { loadSharedConversation, type SharedConversationSnapshot } from '@/lib/co-managed/loadSharedConversation';
import { mapConversationItem, isWritableOwnItem, toSharedEditPatch, sharedEditKey, RESTRICTED_AUTHOR_REFERENCE,
  type SharedConversationContext } from '@/lib/co-managed/sharedTicketMapping';
import type { SharedTicketDetailsResult } from '@/lib/co-managed/sharedTicketDataTypes';
import { saveSharedTicketEditAction, searchSharedTicketEditOptionsAction } from '@/lib/actions/coManagedTicketEditActions';
import { getCoManagedTicketConversationScreenAction } from '@/lib/actions/coManagedTicketConversationActions';
import { mutateCoManagedTicketCommentAction } from '@/lib/actions/coManagedTicketCommentMutationActions';
import { saveCoManagedPrivateTicketCommentAction } from '@/lib/actions/coManagedPrivateTicketCommentActions';

/**
 * The TicketDataSource for a shared (customer-tenant) ticket viewed from the
 * MSP: the native ticket screen, backed only by admitted, redacted
 * co-managed commands.
 *
 * Rules this file keeps:
 * - Every method of every ticket-id keyed group is overridden here (real
 *   shared command, or an inert answer). A native ticket-id action is never
 *   reached with the foreign id (T003 mounts this under a throwing guard).
 * - Avatar batch actions take an explicit tenant and no auth check: they are
 *   answered locally and never called with the customer tenant.
 * - Viewer-scoped calls (session user, permissions, layout, display settings,
 *   mention search) stay on the local session.
 * - No value is invented for an undisclosed field; unsupported collections
 *   are empty and the sections that show them are absent.
 */

export type SharedTicketTranslate = (key: string, options?: Record<string, unknown>) => string;

export interface SharedTicketLoaded {
  details: SharedTicketDetailsResult;
  conversation: SharedConversationSnapshot;
}

export interface SharedTicketSourceOptions {
  t: SharedTicketTranslate;
  /** Reload the screen from the server (own writes that need fresh server data, audience changes). */
  refresh: (mode: TicketRefreshMode) => void | Promise<void>;
  /** The Customer Tickets list. */
  backHref: string;
  /** Time wiring (work reference, entries list); see `useCoManagedSharedTimeConfig`. */
  time?: TicketTimeConfig;
  /** Open the existing disclosure dialog for a thread; resolves once the audience was saved. */
  requestDisclosure: (request: { thread: { storeTenant: string; threadId: string }; actor: { tenant: string; userId: string }; audiences: CommentAudience[] }) => Promise<void>;
  /** Test seam: the data source to build on. Defaults to the native source. */
  base?: TicketDataSource;
}

const ALL_AUDIENCES: CommentAudience[] = ['requester', 'shared_it', 'organization_private'];
const MAX_OPTION_PAGES = 20;

/** Same shape the native actions return for a failure, so the screen's existing handling toasts it and reverts. */
const actionError = (message: string) => ({ actionError: message }) as never;

type Kind = 'null' | 'list' | 'error' | 'custom';
type InertTable<G> = { [K in keyof G]: Kind };

/**
 * One row per method of every ticket-id keyed group. `custom` rows are
 * implemented below; every other row is an inert answer. Typed against the
 * group interfaces, so adding a method to the seam is a compile error here
 * until it is classified.
 */
const INERT: {
  ticket: InertTable<TicketDataSource['ticket']>; comments: InertTable<TicketDataSource['comments']>;
  people: InertTable<TicketDataSource['people']>; resources: InertTable<TicketDataSource['resources']>;
  bundles: InertTable<TicketDataSource['bundles']>; checklist: InertTable<TicketDataSource['checklist']>;
  externalLinks: InertTable<TicketDataSource['externalLinks']>; activity: InertTable<TicketDataSource['activity']>;
  email: InertTable<TicketDataSource['email']>; materials: InertTable<TicketDataSource['materials']>;
  tiles: InertTable<TicketDataSource['tiles']>; tags: InertTable<TicketDataSource['tags']>;
  options: InertTable<TicketDataSource['options']>; closeRules: InertTable<TicketDataSource['closeRules']>;
  avatars: InertTable<TicketDataSource['avatars']>;
} = {
  ticket: { getTicketById: 'null', updateTicket: 'custom', deleteTicket: 'error', preCheckDeletion: 'error', updateTicketWithCache: 'custom',
    updateTicketWithCacheForCurrentUser: 'custom', getAdjacentTicketIds: 'null', getRecurringSourceForTicket: 'null', findBoardById: 'custom',
    getScheduledHoursForTicket: 'list', getTicketAppointmentRequests: 'list' },
  comments: { findCommentsByTicketId: 'custom', findCommentById: 'custom', createComment: 'custom', updateComment: 'custom', deleteComment: 'custom',
    addTicketCommentWithCache: 'custom', addTicketCommentWithCacheForCurrentUser: 'custom', cancelScheduledComment: 'error', rescheduleScheduledComment: 'error',
    deleteDraftClipboardImages: 'custom', discardCommentAttachmentDrafts: 'custom', toggleCommentReaction: 'error', getCommentsReactionsBatch: 'custom' },
  people: { findUserById: 'null', getAllUsers: 'list', getAllActiveContacts: 'list', getContactByContactNameId: 'null', getContactsByClient: 'list',
    getClientById: 'null', getAllClients: 'list', getClientLocations: 'list', getClientBillingProfiles: 'list' },
  resources: { addTicketResource: 'error', getTicketResources: 'list', removeTicketResource: 'error', assignTeamToTicket: 'error', removeTeamFromTicket: 'error',
    getTeamById: 'null', getTeams: 'list' },
  bundles: { previewBundleStatusPropagationAction: 'error', addChildrenToBundleAction: 'error', findTicketByNumberAction: 'null', getBundleMasterClosedContextAction: 'null',
    promoteBundleMasterAction: 'error', removeChildFromBundleAction: 'error', unbundleMasterTicketAction: 'error', updateBundleSettingsAction: 'error',
    searchEligibleChildTicketsAction: 'list' },
  checklist: { getTicketChecklistItems: 'list', addChecklistItem: 'error', applyChecklistTemplate: 'error', deleteChecklistItem: 'error', getChecklistTemplates: 'list',
    reorderChecklistItems: 'error', setChecklistItemCompleted: 'error', updateChecklistItem: 'error' },
  externalLinks: { addExternalLink: 'error', getTicketExternalLinks: 'list', listExternalSystems: 'list', removeExternalLink: 'error', updateExternalLink: 'error' },
  activity: { getTicketTimelineEntries: 'list' },
  email: { getEmailLogsForTicket: 'list' },
  materials: { listTicketMaterials: 'list', addTicketMaterial: 'error', deleteTicketMaterial: 'error', searchServiceCatalogForPicker: 'list', getServicePrices: 'list',
    listAvailableStockUnitsForMaterial: 'list', getProductAvailability: 'null' },
  tiles: { getTicketScheduleEntries: 'list', getTicketInteractions: 'list', getTicketBillingRollup: 'null', getTicketAppointmentRequests: 'list', getTicketSlaPolicyName: 'null' },
  tags: { findTagsByEntityId: 'list' },
  options: { getTicketStatuses: 'custom', getAllPriorities: 'custom', getTicketCategories: 'custom', getTicketCategoriesByBoard: 'custom' },
  closeRules: { checkTicketClosure: 'custom', getTicketAutoCloseState: 'null' },
  avatars: { getUserAvatarUrlsBatchAction: 'custom', getTeamAvatarUrlsBatchAction: 'custom', getContactAvatarUrlAction: 'custom' },
};

export function createSharedTicketDataSource(resource: CoManagedSharedResource, loaded: SharedTicketLoaded, options: SharedTicketSourceOptions): TicketDataSource {
  const { t, base = nativeTicketDataSource } = options;
  const { details } = loaded;
  const canWrite = details.screen.canWrite;
  const editable = details.editor.editableFields;
  const message = (code: string) => t(`coManaged.editor.errors.${code}`);

  // ---- conversation state (closure: one data source = one loaded snapshot) ----
  let conversation = loaded.conversation;
  const context = (): SharedConversationContext => ({
    ticketId: resource.id, actor: conversation.actor, writeAudiences: conversation.writeAudiences, resourceTenant: resource.tenant, customerName: details.screen.customerName,
  });
  const itemById = () => new Map(conversation.items.map(item => [item.commentId, item]));
  const mapped = (): IComment[] => [...conversation.items]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.commentId.localeCompare(right.commentId))
    .map(item => mapConversationItem(item, context()));
  const reloadConversation = async () => { conversation = await loadSharedConversation(before => getCoManagedTicketConversationScreenAction(resource, before)); };

  // ---- edits: baselines + operation ids ----
  let baselines: CoManagedTicketEditPatch = { ...details.editor.baselines };
  let editOperation: { key: string; id: string } | null = null;

  const applyEdit = async (changes: Record<string, unknown>) => {
    if (!canWrite) return actionError(message('readOnly'));
    const outcome = toSharedEditPatch(changes, editable);
    if (!outcome.ok) return actionError(message(outcome.code));
    const fields = Object.keys(outcome.patch) as CoManagedTicketEditField[];
    if (!fields.length) return undefined as never;
    const expected: Record<string, string | null> = {};
    for (const field of fields) expected[field] = (baselines[field] as string | null | undefined) ?? null;
    const key = sharedEditKey(expected as CoManagedTicketEditPatch, outcome.patch);
    if (editOperation?.key !== key) editOperation = { key, id: newCoManagedOperationId() };
    try {
      const result = await saveSharedTicketEditAction(resource, { operationId: editOperation.id, expected: expected as CoManagedTicketEditPatch, patch: outcome.patch });
      if (result.ok) {
        baselines = { ...baselines, ...outcome.patch };
        editOperation = null;
        return undefined as never;
      }
      // Only an unconfirmed outcome keeps its operation id (exact retry); a definite answer starts fresh.
      if (result.code !== 'unknownOutcome') editOperation = null;
      return actionError(message(result.code));
    } catch {
      return actionError(message('unknownOutcome'));
    }
  };

  // ---- option pickers (F018): admitted, paged search; never a customer-tenant action ----
  const optionCache = new Map<string, Promise<Array<{ id: string; name: string }>>>();
  const allOptions = (field: 'status_id' | 'priority_id' | 'category_id') => {
    let cached = optionCache.get(field);
    if (!cached) {
      cached = (async () => {
        if (!editable.includes(field)) return [];
        const found: Array<{ id: string; name: string }> = [];
        let afterId: string | undefined;
        for (let page = 0; page < MAX_OPTION_PAGES; page++) {
          const result = await searchSharedTicketEditOptionsAction(resource, { field, ...(afterId ? { afterId } : {}) });
          found.push(...result.options);
          if (!result.nextAfterId) break;
          afterId = result.nextAfterId;
        }
        return found;
      })().catch(error => { optionCache.delete(field); throw error; });
      optionCache.set(field, cached);
    }
    return cached;
  };

  // ---- comments ----
  const staging: AttachmentStaging = createAttachmentStaging(newCoManagedOperationId);
  const failureText = (code: string) =>
    code === 'unknownOutcome' ? t('coManaged.conversation.unknownOutcome')
      : ['notReady', 'abandoned', 'preparationFailed'].includes(code) ? t(`coManaged.conversation.files.${code}`)
      : message(code === 'aborted' ? 'unknownOutcome' : code);

  const writer = createTicketCommentWriter({ resource, staging,
    context: () => ({ canWrite, actorTenant: conversation.actor.tenant, writeAudiences: conversation.writeAudiences,
      draftAttachments: conversation.draftAttachments }),
    parent: commentId => {
      const item = itemById().get(commentId);
      return item ? { storeTenant: item.storeTenant, threadId: item.threadId, commentId: item.commentId } : null;
    },
  });
  const writeComment = async (input: { content: string; audience: CommentAudience; parentCommentId?: string }): Promise<string> => {
    try {
      const receipt = await writer(input);
      await reloadConversation();
      return receipt.commentId;
    } catch (error) {
      throw new Error(failureText(error instanceof TicketCommentWriteError ? error.code : 'unknownOutcome'));
    }
  };

  const audienceFor = (explicit: string | undefined, isInternal: boolean): CommentAudience => {
    if (explicit && (ALL_AUDIENCES as string[]).includes(explicit)) return explicit as CommentAudience;
    return isInternal ? 'shared_it' : 'requester';
  };

  const addComment = async (_ticketId: string, content: string, isInternal: boolean, _isResolution?: boolean, _closes?: boolean, _suppression?: unknown,
    _schedule?: unknown, _recipients?: unknown, writeOptions?: { audienceId?: string }) => {
    try {
      const id = await writeComment({ content, audience: audienceFor(writeOptions?.audienceId, isInternal) });
      return mapped().find(comment => comment.comment_id === id) ?? actionError(message('unknownOutcome'));
    } catch (error) {
      return actionError(error instanceof Error ? error.message : message('unknownOutcome'));
    }
  };

  const createComment = async (comment: IComment & { audienceId?: string }) => {
    try {
      return await writeComment({ content: comment.note ?? '', audience: audienceFor(comment.audienceId, Boolean(comment.is_internal)),
        parentCommentId: comment.parent_comment_id ?? undefined });
    } catch (error) {
      return actionError(error instanceof Error ? error.message : message('unknownOutcome'));
    }
  };

  const mutateOperations = new Map<string, string>();
  const mutateComment = async (commentId: string, change: { kind: 'edit'; content: string } | { kind: 'delete' }) => {
    const item = itemById().get(commentId);
    if (!item || !isWritableOwnItem(item, context())) return actionError(message('forbidden'));
    const document = change.kind === 'edit' ? conversationDocument(change.content) : undefined;
    if (change.kind === 'edit' && !document) return actionError(message('invalid'));
    const key = JSON.stringify([commentId, change.kind, change.kind === 'edit' ? change.content : null, item.updatedAt, item.revision]);
    if (!mutateOperations.has(key)) mutateOperations.set(key, newCoManagedOperationId());
    const operationId = mutateOperations.get(key)!;
    const reference = { storeTenant: item.storeTenant, threadId: item.threadId, commentId: item.commentId };
    try {
      const result = item.storeTenant !== resource.tenant
        ? await saveCoManagedPrivateTicketCommentAction(resource, change.kind === 'edit'
          ? { kind: 'edit', operationId, comment: reference, expectedRevision: item.revision!, document: document! }
          : { kind: 'delete', operationId, comment: reference, expectedRevision: item.revision! })
        : await mutateCoManagedTicketCommentAction(resource, change.kind === 'edit'
          ? { kind: 'edit', operationId, comment: reference, expectedUpdatedAt: item.updatedAt, document: document! }
          : { kind: 'delete', operationId, comment: reference, expectedUpdatedAt: item.updatedAt });
      if (!result.ok) {
        if (result.code !== 'unknownOutcome') mutateOperations.delete(key);
        return actionError(failureText(result.code));
      }
      mutateOperations.delete(key);
      await reloadConversation();
      return undefined as never;
    } catch {
      return actionError(failureText('unknownOutcome'));
    }
  };

  // ---- build the guarded groups: inert rows + the custom implementations ----
  const inert = (kind: Kind, group: string, method: string) => {
    if (kind === 'list') return async () => [];
    if (kind === 'null') return async () => null;
    if (kind === 'error') return async () => actionError(message('forbidden'));
    throw new Error(`Shared ticket data source: ${group}.${method} has no implementation`);
  };
  const custom: Record<string, Record<string, unknown>> = {
    ticket: {
      updateTicket: async (_id: string, data: Record<string, unknown>) => applyEdit(data),
      updateTicketWithCache: async (_id: string, changes: Record<string, unknown>) => applyEdit(changes),
      updateTicketWithCacheForCurrentUser: async (_id: string, changes: Record<string, unknown>) => applyEdit(changes),
      findBoardById: async (boardId: string) => {
        const board = details.ticketData.board;
        return board && board.board_id === boardId ? { board_id: board.board_id, board_name: board.board_name } : null;
      },
    },
    comments: {
      findCommentsByTicketId: async () => { await reloadConversation(); return mapped(); },
      findCommentById: async (commentId: string) => mapped().find(comment => comment.comment_id === commentId) ?? null,
      createComment,
      updateComment: async (commentId: string, updates: { note?: string }) =>
        typeof updates?.note === 'string' ? mutateComment(commentId, { kind: 'edit', content: updates.note }) : (undefined as never),
      deleteComment: async (commentId: string) => mutateComment(commentId, { kind: 'delete' }),
      addTicketCommentWithCache: addComment,
      addTicketCommentWithCacheForCurrentUser: addComment,
      deleteDraftClipboardImages: async () => ({ deletedDocumentIds: [], failures: [] }),
      discardCommentAttachmentDrafts: async () => ({ deletedDocumentIds: [], failures: [] }),
      getCommentsReactionsBatch: async () => ({ reactions: {}, userNames: {} }),
    },
    options: {
      getTicketStatuses: async () => (await allOptions('status_id')).map(option => ({ status_id: option.id, name: option.name })),
      getAllPriorities: async () => (await allOptions('priority_id')).map(option => ({ priority_id: option.id, priority_name: option.name })),
      getTicketCategories: async () => (await allOptions('category_id')).map(option => ({ category_id: option.id, category_name: option.name, board_id: details.ticketData.board?.board_id ?? null, parent_category: null })),
      getTicketCategoriesByBoard: async () => ({
        categories: (await allOptions('category_id')).map(option => ({ category_id: option.id, category_name: option.name, board_id: details.ticketData.board?.board_id ?? null, parent_category: null })),
        boardConfig: { category_type: 'custom', priority_type: 'custom', display_itil_impact: false, display_itil_urgency: false },
      }),
    },
    // Closing requirements are enforced by the shared edit command; its refusal is shown as `closeRules`.
    closeRules: { checkTicketClosure: async () => ({ wouldClose: false, allowed: true, failures: [], canOverride: false }) },
    avatars: {
      getUserAvatarUrlsBatchAction: async () => new Map<string, string | null>(),
      getTeamAvatarUrlsBatchAction: async () => new Map<string, string | null>(),
      getContactAvatarUrlAction: async () => null,
    },
  };
  const groups: Record<string, Record<string, unknown>> = {};
  for (const [group, table] of Object.entries(INERT)) {
    groups[group] = Object.fromEntries(Object.entries(table as Record<string, Kind>).map(([method, kind]) => [
      method, kind === 'custom' ? custom[group]?.[method] ?? inert(kind, group, method) : inert(kind, group, method),
    ]));
  }

  // ---- screen configuration ----
  const frozenFields = TICKET_SCREEN_FIELDS.filter(field => !(editable as readonly string[]).includes(field));
  const capabilities: TicketCapabilities = { ...NO_TICKET_CAPABILITIES, timeEntry: canWrite };
  const allowedAudiences = conversation.writeAudiences;
  const audienceLabel = (audience: string) => t(`coManaged.conversation.audiences.${audience}`);
  const audienceOptions = allowedAudiences.map(audience => ({ id: audience, label: audienceLabel(audience), internal: audience !== 'requester' }));
  const audienceOf = (comment: IComment): CommentAudience =>
    (comment.comment_id ? itemById().get(comment.comment_id)?.audience : undefined) ?? (comment.is_internal ? 'shared_it' : 'requester');
  const changeable = (comment: IComment) => {
    const item = comment.comment_id ? itemById().get(comment.comment_id) : undefined;
    return Boolean(item && !item.parentCommentId && isWritableOwnItem(item, context()));
  };

  const overrides: TicketDataSourceOverrides = {
    capabilities,
    screen: {
      refresh: options.refresh,
      backHref: options.backHref,
      readOnly: !canWrite,
      frozenFields,
    },
    conversation: {
      audiences: {
        options: audienceOptions,
        defaultId: allowedAudiences.includes('shared_it') ? 'shared_it' : allowedAudiences[0] ?? 'shared_it',
        controlLabel: t('coManaged.conversation.audience'),
        getCommentAudience: comment => { const audience = audienceOf(comment); return { id: audience, label: audienceLabel(audience) }; },
        canChangeCommentAudience: changeable,
        changeCommentAudience: comment => {
          const item = comment.comment_id ? itemById().get(comment.comment_id) : undefined;
          // Never settles for a change that did not start: no reload.
          if (!item || !changeable(comment)) return new Promise<void>(() => {});
          return options.requestDisclosure({ thread: { storeTenant: item.storeTenant, threadId: item.threadId }, actor: conversation.actor,
            audiences: conversation.actor.tenant === resource.tenant ? [...allowedAudiences] : allowedAudiences.filter(value => value !== 'organization_private') });
        },
      },
      // The co-managed document model has no images, files or local mentions; files travel as attachments below.
      editor: { disallowImages: true, disallowFiles: true, disallowMentions: true },
      composerFeatures: { schedule: false, resolution: false },
      composerFooter: ({ audienceId, disabled }) => (
        <SharedCommentAttachmentPicker staging={staging} limits={conversation.draftAttachments}
          attachable={Boolean(audienceId && conversation.draftAttachments.audiences.includes(audienceId as CommentAudience))} disabled={disabled} />
      ),
      formatAuthorLabel: ({ comment, authorName }) => comment.actor_reference_id === RESTRICTED_AUTHOR_REFERENCE ? t('coManaged.conversation.restrictedAuthor') : authorName,
    },
    slots: {
      coManagedSection: ({ layout, refresh }) => <CoManagedTicketSection target={{ kind: 'shared', resource }} onChanged={refresh} layout={layout} />,
      timeSummary: ({ timeEntriesRefreshKey }) => canWrite
        ? <CoManagedEffortSummary target={{ kind: 'shared', resource }} refreshKey={timeEntriesRefreshKey} billingProfile /> : null,
    },
    time: options.time ?? {},
    ...(groups as unknown as TicketDataSourceOverrides),
  };
  return composeTicketDataSource({ ...base, kind: 'shared', boundTicketId: resource.id }, overrides);
}
