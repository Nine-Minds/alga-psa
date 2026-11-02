import type { IComment } from '@alga-psa/types';
import type { CoManagedConversationItem } from '@alga-psa/co-managed';

/** Who is looking: the conversation is shaped for this tenant's screen. */
export interface SharedConversationViewer { tenant: string; userId: string }

/** An author in the viewer's own tenant resolves through the screen's user/contact maps; a foreign one never does. */
const isLocalAuthor = (item: CoManagedConversationItem, viewer: SharedConversationViewer) =>
  item.author != null && item.author.tenant === viewer.tenant && item.author.id != null;

/**
 * One admitted conversation item as the native screen's comment. Foreign authors carry only the
 * owner-attributed reference, name and organization (the comment resolver never looks them up
 * locally); the viewer's own authors carry their id so the screen's maps can show them.
 */
export function mapConversationItem(item: CoManagedConversationItem, ticketId: string, viewer: SharedConversationViewer): IComment {
  const author = item.author;
  const local = isLocalAuthor(item, viewer);
  const system = author?.kind === 'system';
  return {
    tenant: item.storeTenant,
    comment_id: item.commentId,
    ticket_id: ticketId,
    thread_id: item.threadId,
    parent_comment_id: item.parentCommentId,
    note: item.note ?? '',
    ...(item.markdown != null ? { markdown_content: item.markdown } : {}),
    audience: item.audience,
    is_internal: item.audience !== 'requester',
    is_resolution: false,
    is_system_generated: system,
    author_type: system ? 'system' : author?.kind === 'contact' ? 'contact' : author?.kind === 'user' ? 'internal' : 'unknown',
    created_at: item.createdAt,
    updated_at: item.updatedAt ?? item.createdAt,
    ...(local && author?.kind === 'user' ? { user_id: author.id } : {}),
    ...(local && author?.kind === 'contact' ? { contact_id: author.id } : {}),
    ...(!local && author && !system ? {
      actor_reference_id: author.referenceId, actor_display_name: author.displayName, actor_organization_name: author.organizationName,
    } : {}),
  } as IComment;
}

/** The comment items in thread order (oldest first), mapped; deleted items are never shown. */
export function mapConversation(items: readonly CoManagedConversationItem[], ticketId: string, viewer: SharedConversationViewer): IComment[] {
  return items
    .filter(item => !item.deleted)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.commentId.localeCompare(b.commentId))
    .map(item => mapConversationItem(item, ticketId, viewer));
}

/** Display maps for the viewer's own authors, built from the admitted items themselves (no extra lookup). */
export function conversationAuthorMaps(items: readonly CoManagedConversationItem[], viewer: SharedConversationViewer) {
  const userMap: Record<string, { user_id: string; first_name: string; last_name: string; user_type: string; avatarUrl: string | null }> = {};
  const contactMap: Record<string, { contact_id: string; full_name: string; avatarUrl: string | null }> = {};
  for (const item of items) {
    const author = item.author;
    if (!author || !isLocalAuthor(item, viewer)) continue;
    if (author.kind === 'user') userMap[author.id!] ??= { user_id: author.id!, first_name: author.displayName ?? '', last_name: '', user_type: 'internal', avatarUrl: null };
    if (author.kind === 'contact') contactMap[author.id!] ??= { contact_id: author.id!, full_name: author.displayName ?? '', avatarUrl: null };
  }
  return { userMap, contactMap };
}
