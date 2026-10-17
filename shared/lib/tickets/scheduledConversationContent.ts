import { createHash } from 'node:crypto';

/** Scheduling may move the due time; it cannot substitute content or authorship
 * beneath the accepted envelope. Canonical fields are read after insertion. */
export function scheduledConversationContentHash(comment: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(Object.fromEntries([
    'ticket_id', 'thread_id', 'parent_comment_id', 'user_id', 'author_type', 'is_internal', 'is_resolution', 'note', 'markdown_content',
  ].map(key => [key, comment[key] ?? null])))).digest('hex');
}
