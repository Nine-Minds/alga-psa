import type { IComment } from '@alga-psa/types';
import type { CoManagedConversationItem, CoManagedTicketEditField, CoManagedTicketEditPatch } from '@alga-psa/co-managed';
import type { SharedTicketData, SharedTicketDetailsResult } from './sharedTicketDataTypes';

/**
 * Pure, client-safe translation between the native ticket screen's shapes and
 * the shared (co-managed) commands. No I/O, no session access: everything the
 * mapping needs is passed in, so it is unit-testable and cannot reach a
 * native ticket-id action.
 */

/** Marker on `actor_reference_id` for a comment whose author the viewer may not see. */
export const RESTRICTED_AUTHOR_REFERENCE = 'co-managed:restricted-author';

const EDITABLE_FIELDS: readonly CoManagedTicketEditField[] = ['title', 'url', 'status_id', 'priority_id', 'due_date', 'response_state', 'description', 'category_id'];

export type SharedEditMapping =
  | { ok: true; patch: CoManagedTicketEditPatch }
  | { ok: false; code: 'invalid' | 'forbidden' };

const nullable = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '' || value === 'unassigned') return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
  return typeof value === 'string' ? value : undefined;
};

/**
 * Translate the native screen's `changes` object into a shared edit patch.
 * Anything the shared model cannot write (assignee, board, client, ...) is
 * `forbidden`, never silently dropped; a field the caller may not edit is
 * `forbidden` too. The category change clears the subcategory on the server,
 * so a null/absent `subcategory_id` that rides along is not a change.
 */
export function toSharedEditPatch(changes: Record<string, unknown>, editable: readonly CoManagedTicketEditField[]): SharedEditMapping {
  const patch: Record<string, string | null> = {};
  for (const [key, raw] of Object.entries(changes ?? {})) {
    if (key === 'attributes') {
      // The native description save sends the whole attributes object; only the description is a shared field.
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'invalid' };
      if (!('description' in raw)) continue;
      const description = (raw as { description?: unknown }).description;
      if (description !== null && typeof description !== 'string') return { ok: false, code: 'invalid' };
      patch.description = description as string | null;
      continue;
    }
    if (key === 'subcategory_id') {
      if (raw === undefined || raw === null || raw === '') continue;
      return { ok: false, code: 'forbidden' };
    }
    if (!(EDITABLE_FIELDS as readonly string[]).includes(key)) return { ok: false, code: 'forbidden' };
    const value = nullable(raw);
    if (value === undefined) return { ok: false, code: 'invalid' };
    patch[key] = value;
  }
  for (const field of Object.keys(patch)) {
    if (!editable.includes(field as CoManagedTicketEditField)) return { ok: false, code: 'forbidden' };
  }
  return { ok: true, patch: patch as CoManagedTicketEditPatch };
}

/** Stable identity of one intended edit, so a retry replays the same operation id. */
export const sharedEditKey = (expected: CoManagedTicketEditPatch, patch: CoManagedTicketEditPatch): string =>
  JSON.stringify([Object.entries(expected).sort(), Object.entries(patch).sort()]);

export interface SharedConversationContext {
  ticketId: string;
  /** The viewer's own identity (their home tenant and login). */
  actor: { tenant: string; userId: string };
  /** Audiences the viewer may write to. */
  writeAudiences: readonly string[];
  /** The customer workspace's tenant: the store of every non-private item. */
  resourceTenant: string;
  customerName: string;
}

/** Whether the viewer wrote this item with their own login. */
export const isOwnConversationItem = (item: CoManagedConversationItem, actor: { tenant: string; userId: string }): boolean =>
  item.author?.kind === 'user' && item.author.tenant === actor.tenant && item.author.id === actor.userId;

/** The viewer may edit/delete this item through the shared commands. */
export const isWritableOwnItem = (item: CoManagedConversationItem, context: SharedConversationContext): boolean =>
  !item.deleted && isOwnConversationItem(item, context.actor) && context.writeAudiences.includes(item.audience) &&
  (item.storeTenant === context.resourceTenant || item.revision !== null);

/**
 * One admitted conversation item as the native screen's comment.
 *
 * - The viewer's own editable messages carry their login (`user_id`) so the
 *   native edit/delete affordances appear; the screen resolves the name from
 *   the viewer's entry in `userMap`.
 * - Every other author is a collaborator attribution ("Name (Organization)")
 *   with NO user or contact id, so nothing is ever resolved through a local map.
 * - A hidden author is marked with {@link RESTRICTED_AUTHOR_REFERENCE}; the
 *   data source's author label shows the restricted-author text for it.
 */
export function mapConversationItem(item: CoManagedConversationItem, context: SharedConversationContext): IComment {
  const base: IComment = {
    tenant: item.storeTenant,
    comment_id: item.commentId,
    ticket_id: context.ticketId,
    thread_id: item.threadId,
    parent_comment_id: item.parentCommentId,
    author_type: 'internal',
    note: item.deleted ? '' : item.note ?? item.markdown ?? '',
    markdown_content: item.deleted ? '' : item.markdown ?? undefined,
    // Only the requester audience reaches the requester; everything else is internal to the IT teams.
    is_internal: item.audience !== 'requester',
    is_resolution: false,
    created_at: item.createdAt,
    updated_at: item.updatedAt ?? item.createdAt,
    deleted_at: item.deleted ? item.updatedAt ?? item.createdAt : null,
    publish_state: 'published',
  };
  const author = item.author;
  if (isWritableOwnItem(item, context)) return { ...base, user_id: context.actor.userId };
  if (!author) return { ...base, author_type: 'unknown', actor_reference_id: RESTRICTED_AUTHOR_REFERENCE, actor_display_name: RESTRICTED_AUTHOR_REFERENCE, actor_organization_name: RESTRICTED_AUTHOR_REFERENCE };
  if (author.kind === 'system') return { ...base, author_type: 'internal', is_system_generated: true };
  const name = author.displayName?.trim();
  if (!name) return { ...base, author_type: 'unknown', actor_reference_id: RESTRICTED_AUTHOR_REFERENCE, actor_display_name: RESTRICTED_AUTHOR_REFERENCE, actor_organization_name: RESTRICTED_AUTHOR_REFERENCE };
  return {
    ...base,
    author_type: author.kind === 'contact' ? 'client' : 'internal',
    actor_reference_id: author.referenceId ?? `${author.kind}:${author.tenant}:${author.id ?? item.commentId}`,
    actor_display_name: name,
    actor_organization_name: author.organizationName?.trim() || context.customerName,
  };
}

/** The ticket data the native container renders, with the workspace name where the client name sits. */
export function withWorkspaceHeader(data: SharedTicketData, customerName: string): SharedTicketData {
  const end = data.client?.client_name?.trim();
  return { ...data, client: { client_name: end && end !== customerName ? `${customerName} · ${end}` : customerName } };
}

/** `ticketData` for the container: details with the full admitted conversation and the viewer's own map entry. */
export function buildSharedTicketScreenData(details: SharedTicketDetailsResult, comments: IComment[],
  viewer?: { user_id: string; first_name: string; last_name: string; email?: string; user_type: string }): SharedTicketData & { comments: IComment[] } {
  const header = withWorkspaceHeader(details.ticketData, details.screen.customerName);
  return {
    ...header,
    comments: comments as never,
    userMap: (viewer ? { [viewer.user_id]: { ...viewer, avatarUrl: null } } : {}) as never,
  } as unknown as SharedTicketData & { comments: IComment[] };
}
