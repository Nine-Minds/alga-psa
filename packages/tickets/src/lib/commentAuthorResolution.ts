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
  source: 'user' | 'contact' | 'unknown';
  displayName: string;
  email?: string;
  userId?: string;
  contactId?: string;
  userType?: string;
  avatarKind: 'user' | 'contact' | 'unknown';
  avatarUrl: string | null;
}

const UNKNOWN_AUTHOR: ResolvedCommentAuthor = {
  source: 'unknown',
  displayName: 'Unknown User',
  avatarKind: 'unknown',
  avatarUrl: null,
};

export function resolveCommentAuthor(
  comment: Pick<IComment, 'user_id' | 'contact_id'>,
  options: {
    userMap: Record<string, CommentUserAuthor>;
    contactMap?: Record<string, CommentContactAuthor>;
  }
): ResolvedCommentAuthor {
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
