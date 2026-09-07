import type { IComment } from '@alga-psa/types';

export interface CommentUserAuthor {
  user_id: string;
  first_name: string;
  last_name: string;
  email?: string;
  user_type: string;
  avatarUrl: string | null;
}

export interface CommentContactAuthor {
  contact_id: string;
  full_name: string;
  email?: string;
  avatarUrl: string | null;
}

export interface ResolvedCommentAuthor {
  source: 'user' | 'contact' | 'collaborator' | 'unknown';
  displayName: string;
  email?: string;
  userId?: string;
  contactId?: string;
  userType?: string;
  avatarKind: 'user' | 'contact' | 'unknown';
  avatarUrl: string | null;
  avatarName?: string;
}

const UNKNOWN_AUTHOR: ResolvedCommentAuthor = {
  source: 'unknown',
  displayName: 'Unknown User',
  avatarKind: 'unknown',
  avatarUrl: null,
};

type CommentAuthorFields = Pick<IComment, 'user_id' | 'contact_id' | 'actor_reference_id' | 'actor_display_name' | 'actor_organization_name'>;

/** Partial or malformed foreign attribution must not trigger a local lookup. */
export function hasCommentCollaborationAttribution(comment: CommentAuthorFields): boolean {
  return [comment.actor_reference_id, comment.actor_display_name, comment.actor_organization_name].some(value => value != null);
}

export function resolveCommentAuthor(
  comment: CommentAuthorFields,
  options: {
    userMap: Record<string, CommentUserAuthor>;
    contactMap?: Record<string, CommentContactAuthor>;
  }
): ResolvedCommentAuthor {
  if (hasCommentCollaborationAttribution(comment)) {
    // Never resolve an attributed foreign author through an owner-local user or
    // contact map, even if a malformed/partial DTO also contains those IDs.
    if (comment.user_id || comment.contact_id || typeof comment.actor_reference_id !== 'string' || !comment.actor_reference_id.trim() ||
        typeof comment.actor_display_name !== 'string' || !comment.actor_display_name.trim() ||
        typeof comment.actor_organization_name !== 'string' || !comment.actor_organization_name.trim()) return { ...UNKNOWN_AUTHOR, source: 'collaborator' };
    return { source: 'collaborator', displayName: `${comment.actor_display_name} (${comment.actor_organization_name})`,
      avatarName: comment.actor_display_name, avatarKind: 'user', avatarUrl: null };
  }
  if (comment.user_id) {
    const user = options.userMap[comment.user_id];
    if (user) {
      const displayName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Unknown User';
      return {
        source: 'user',
        displayName,
        email: user.email,
        userId: user.user_id,
        userType: user.user_type,
        avatarKind: user.user_type === 'internal' ? 'user' : 'contact',
        avatarUrl: user.avatarUrl,
      };
    }
  }

  if (comment.contact_id && options.contactMap) {
    const contact = options.contactMap[comment.contact_id];
    if (contact) {
      return {
        source: 'contact',
        displayName: contact.full_name || 'Unknown User',
        email: contact.email,
        contactId: contact.contact_id,
        avatarKind: 'contact',
        avatarUrl: contact.avatarUrl,
      };
    }
  }

  return UNKNOWN_AUTHOR;
}
