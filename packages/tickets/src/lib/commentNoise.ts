import type { IComment } from '@alga-psa/types';

// Hides inbound-email comments whose body is empty or contains only a reply
// token marker. The token data still lives in the saved comment row so email
// threading (token + In-Reply-To/References fallback) stays intact; this just
// suppresses the noise in the conversation/timeline views.
const REPLY_TOKEN_ONLY_REGEX = /^\s*\[ALGA-REPLY-TOKEN [^\]]+\]\s*$/;

// Mirrors TextEditor's MEDIA_BLOCK_TYPES: blocks that carry content in props
// rather than in text nodes, so a textless comment can still be real content.
const MEDIA_BLOCK_TYPES = new Set(['image', 'video', 'audio', 'file']);

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

function hasMediaBlock(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasMediaBlock);
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (typeof obj.type === 'string' && MEDIA_BLOCK_TYPES.has(obj.type)) {
      const props = obj.props as Record<string, unknown> | undefined;
      if (props?.url || props?.name) return true;
    }
    if (hasMediaBlock(obj.content)) return true;
    if (hasMediaBlock(obj.children)) return true;
  }
  return false;
}

function readCommentNote(note: string | undefined | null): { text: string; hasMedia: boolean } {
  if (!note) return { text: '', hasMedia: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(note);
  } catch {
    return { text: note.trim(), hasMedia: false };
  }
  return { text: collectBlockNoteText(parsed).trim(), hasMedia: hasMediaBlock(parsed) };
}

export function isHiddenNoiseComment(comment: IComment): boolean {
  const { text, hasMedia } = readCommentNote(comment.note);
  // Token-only inbound email stays hidden even when the mail carried images,
  // so signature logos and tracking pixels don't resurrect the noise.
  if (REPLY_TOKEN_ONLY_REGEX.test(text)) return true;
  if (text !== '') return false;
  // Textless is only noise when there is nothing to look at either: a pasted
  // screenshot with no caption is a real comment.
  return !hasMedia;
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
