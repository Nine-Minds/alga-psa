'use client';

import type { IComment } from '@alga-psa/types';
import type { CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import { getCoManagedTicketConversationScreenAction } from '@/lib/actions/coManagedTicketConversationActions';
import { loadSharedConversation, type SharedConversationSnapshot } from '@/lib/co-managed/loadSharedConversation';
import { mapConversation } from '@/lib/co-managed/sharedConversationMapping';
import type { AttachmentStaging } from '@/lib/co-managed/attachmentStaging';
import { createTicketCommentWriter, PLAIN_TEXT_WRITER, TicketCommentWriteError } from './ticketCommentWriter';

export type SharedConversationTranslate = (key: string, defaultValue: string) => string;

/** User-facing text for a refused or unconfirmed write; every writer code has one, nothing else leaks through. */
export function sharedWriteFailureText(t: SharedConversationTranslate, code: string): string {
  switch (code) {
    case 'forbidden': return t('conversation.shared.errors.forbidden', 'You are not allowed to post to this audience.');
    case 'invalid': return t('conversation.shared.errors.invalid', 'This comment cannot be posted.');
    case 'readOnly': return t('conversation.shared.errors.readOnly', 'This workspace is read-only right now.');
    case 'operationConflict': return t('conversation.shared.errors.operationConflict', 'This comment conflicts with an earlier attempt. Reload and try again.');
    case 'audienceUnresolved': return t('conversation.shared.errors.audienceUnresolved', 'Choose who can see this comment before posting it.');
    default: return t('conversation.shared.errors.unknownOutcome', 'We could not confirm the comment was posted. Check the conversation before sending it again.');
  }
}

/**
 * One loaded shared conversation plus the writer that posts to it. The writer is resolved
 * through the registry (`kind`, default plain text), so a feature layer can register a richer
 * writer without this session changing. Reads and writes go only through the admitted
 * co-managed commands; this adds no authority.
 */
export function createSharedConversationSession(resource: CoManagedSharedResource, options: { t: SharedConversationTranslate; kind?: string;
  /** Files chosen for the next message; sent through the registered file stager and cleared only once the message is saved. */
  staging?: AttachmentStaging }) {
  let snapshot: SharedConversationSnapshot | null = null;
  const writer = createTicketCommentWriter({
    kind: options.kind ?? PLAIN_TEXT_WRITER,
    resource,
    ...(options.staging ? { files: () => options.staging!.getSnapshot() } : {}),
    context: () => ({ canWrite: (snapshot?.writeAudiences.length ?? 0) > 0, actorTenant: snapshot?.actor.tenant ?? '', writeAudiences: snapshot?.writeAudiences ?? [] }),
    parent: commentId => {
      const item = snapshot?.items.find(candidate => candidate.commentId === commentId);
      return item ? { storeTenant: item.storeTenant, threadId: item.threadId, commentId: item.commentId } : null;
    },
  });
  // A version signal bumped after EVERY completed load (initial, post-write refresh, disclosure
  // reload), so panels that read `snapshot()` re-render without being handed a counter by each host.
  let version = 0;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  // The last write that left staged files unsent (a draft the server may already hold). The files panel shows it as an alert.
  let unsent: { code: string } | null = null;
  const setUnsent = (next: { code: string } | null) => { unsent = next; listeners.forEach(listener => listener()); };
  const comments = () => snapshot ? mapConversation(snapshot.items, resource.id, snapshot.actor) : [];
  const load = async () => {
    snapshot = await loadSharedConversation(before => getCoManagedTicketConversationScreenAction(resource, before));
    version += 1;
    listeners.forEach(listener => listener());
    return snapshot;
  };
  return {
    load,
    snapshot: () => snapshot,
    subscribe,
    /** Monotonic; changes exactly when a load completes. */
    version: () => version,
    /** Audiences the signed-in viewer may write to (server-resolved; empty until loaded). */
    writeAudiences: (): readonly CommentAudience[] => snapshot?.writeAudiences ?? [],
    comments,
    /** Set when a write carrying files failed; the draft may be waiting under "Unsent messages". Cleared by the next write that succeeds. */
    unsentFailure: () => unsent,
    /** Audience of an existing comment (a reply inherits its thread's audience). */
    audienceOf: (commentId: string): CommentAudience | undefined =>
      snapshot?.items.find(item => item.commentId === commentId)?.audience as CommentAudience | undefined,
    /** Post one message, reload, and return the stored comment. Throws a localized Error on any refusal. */
    async write(message: { content: string; audience: CommentAudience; parentCommentId?: string }): Promise<IComment> {
      let commentId: string;
      const withFiles = (options.staging?.getSnapshot().length ?? 0) > 0;
      try {
        commentId = (await writer(message)).commentId;
      } catch (error) {
        const code = error instanceof TicketCommentWriteError ? error.code : 'unknownOutcome';
        if (withFiles) setUnsent({ code });
        throw new Error(sharedWriteFailureText(options.t, code));
      }
      if (unsent) setUnsent(null);
      options.staging?.clear();
      // The write is durable; a failed refresh must not read as a failed post.
      try { await load(); } catch { /* the next screen load shows it */ }
      const stored = comments().find(comment => comment.comment_id === commentId);
      if (!stored) throw new Error(sharedWriteFailureText(options.t, 'unknownOutcome'));
      return stored;
    },
  };
}
export type SharedConversationSession = ReturnType<typeof createSharedConversationSession>;
