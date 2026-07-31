import type { IComment } from '@alga-psa/types';

// Hides inbound-email comments whose body is empty or contains only a reply
// token marker. The token data still lives in the saved comment row so email
// threading (token + In-Reply-To/References fallback) stays intact; this just
// suppresses the noise in the conversation/timeline views.
const REPLY_TOKEN_ONLY_REGEX = /^\s*\[ALGA-REPLY-TOKEN [^\]]+\]\s*$/;

function collectBlockNoteText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    let out = '';
    for (const item of node) out += collectBlockNoteText(item);
    return out;
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (obj.type === 'text' && typeof obj.text === 'string') {
      return obj.text;
    }
    if (Array.isArray(obj.content)) {
      return collectBlockNoteText(obj.content);
    }
  }
  return '';
}

function extractCommentText(note: string | undefined | null): string {
  if (!note) return '';
  try {
    return collectBlockNoteText(JSON.parse(note)).trim();
  } catch {
    return note.trim();
  }
}

export function isHiddenNoiseComment(comment: IComment): boolean {
  const text = extractCommentText(comment.note);
  if (text === '') return true;
  return REPLY_TOKEN_ONLY_REGEX.test(text);
}

/** Drops noise comments, keeping any that have descendants so children don't orphan. */
export function filterHiddenNoiseComments(comments: IComment[]): IComment[] {
  const parentIds = new Set<string>();
  for (const comment of comments) {
    if (comment.parent_comment_id) {
      parentIds.add(comment.parent_comment_id);
    }
  }
  return comments.filter((comment) => {
    if (!isHiddenNoiseComment(comment)) return true;
    return comment.comment_id ? parentIds.has(comment.comment_id) : true;
  });
}
