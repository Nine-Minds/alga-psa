import {
  COMMENT_RESPONSE_SOURCES,
  type CommentResponseSource,
  type IComment,
} from '@alga-psa/types';

function normalizeResponseSource(
  source: unknown
): CommentResponseSource | null {
  if (
    source === COMMENT_RESPONSE_SOURCES.CLIENT_PORTAL ||
    source === COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL
  ) {
    return source;
  }

  return null;
}

function isCustomerComment(comment: IComment): boolean {
  if (comment.is_internal) {
    return false;
  }

  return comment.author_type === 'client' || comment.author_type === 'contact';
}

export function getCommentResponseSource(
  comment: IComment
): CommentResponseSource | null {
  const explicitSource =
    normalizeResponseSource(comment.metadata?.responseSource) ??
    normalizeResponseSource(comment.response_source);
  if (explicitSource) {
    return explicitSource;
  }

  if (comment.metadata?.email) {
    return COMMENT_RESPONSE_SOURCES.INBOUND_EMAIL;
  }

  if (comment.author_type === 'client' && comment.user_id) {
    return COMMENT_RESPONSE_SOURCES.CLIENT_PORTAL;
  }

  return null;
}

export function getLatestCustomerResponseSource(
  conversations: IComment[] | null | undefined
): CommentResponseSource | null {
  if (!conversations?.length) {
    return null;
  }

  for (let index = conversations.length - 1; index >= 0; index -= 1) {
    const comment = conversations[index];
    if (!isCustomerComment(comment)) {
      continue;
    }

    const source = getCommentResponseSource(comment);
    if (source) {
      return source;
    }
  }

  return null;
}
