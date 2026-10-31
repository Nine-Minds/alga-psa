'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { IComment } from '@alga-psa/types';
import type { CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { nativeTicketDataSource } from '@alga-psa/tickets/lib/nativeTicketDataSource';
import { TicketDataSourceProvider } from '@alga-psa/tickets/components/ticket/TicketDataSourceContext';
import { composeTicketDataSource, type TicketDataSource, type TicketDataSourceOverrides } from '@alga-psa/tickets/lib/ticketDataSource';
import { getCoManagedLocalTicketResourceAction } from '@/lib/actions/coManagedLocalTicketActions';
import { createAttachmentStaging } from '@/lib/co-managed/attachmentStaging';
import { createSharedConversationSession, type SharedConversationSession } from './sharedConversationSession';
import CoManagedConversationFiles from './CoManagedConversationFiles';

/** Audiences a co_managed workspace's own tickets offer before the server has resolved the shared ones. */
const NATIVE_AUDIENCES: readonly CommentAudience[] = ['requester', 'organization_private'];

/**
 * Data source for a co_managed workspace's own (local) ticket. The ticket stays native; the
 * conversation gains the audience choice. `shared_it` (and a reply into a shared thread) goes
 * through the co-managed comment command; requester and organization_private stay on the native
 * path with their audience. A workspace without a relationship simply never learns `shared_it`.
 */
export function CoManagedLocalTicketDataSourceProvider({ ticketId, children }: { ticketId: string; children: React.ReactNode }) {
  const { t } = useTranslation('features/tickets');
  const [session, setSession] = useState<SharedConversationSession | null>(null);
  const [version, setVersion] = useState(0);
  const [resource, setResource] = useState<Awaited<ReturnType<typeof getCoManagedLocalTicketResourceAction>>>(null);
  const staging = useMemo(() => createAttachmentStaging(() => globalThis.crypto.randomUUID()), [ticketId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resource = await getCoManagedLocalTicketResourceAction(ticketId);
        if (!resource || cancelled) return;
        const next = createSharedConversationSession(resource, { t: (key, fallback) => t(key, { defaultValue: fallback }), staging });
        await next.load();
        if (!cancelled) { setResource(resource); setSession(next); setVersion(v => v + 1); }
      } catch {
        // No shared conversation is reachable: the ticket keeps its native audiences.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  const dataSource = useMemo<TicketDataSource>(() => {
    const shared = session?.writeAudiences() ?? [];
    const audiences: CommentAudience[] = [...NATIVE_AUDIENCES, ...(shared.includes('shared_it') ? ['shared_it' as const] : [])];
    const native = nativeTicketDataSource.comments;
    const viaWriter = (audience: unknown, parent?: string | null) =>
      !!session && (audience === 'shared_it' || (!!parent && session.audienceOf(parent) === 'shared_it'));
    const failure = (error: unknown) => ({ actionError: error instanceof Error ? error.message : 'Failed to add comment' }) as never;
    const addComment = (nativeAdd: (...args: any[]) => Promise<unknown>) => async (...args: any[]) => {
      const [, content, , , , , , , audienceId] = args;
      if (!viaWriter(audienceId)) return nativeAdd(...args);
      try { return await session!.write({ content, audience: 'shared_it' }); } catch (error) { return failure(error); }
    };
    return composeTicketDataSource(nativeTicketDataSource, {
      conversation: { audiences, editor: { disallowImages: true, disallowFiles: true, disallowMentions: true } },
      comments: {
        findCommentsByTicketId: async (id: string, ...rest: unknown[]) => {
          const local = await (native.findCommentsByTicketId as (...a: unknown[]) => Promise<IComment[]>)(id, ...rest);
          if (!session) return local;
          try { await session.load(); } catch { return local; }
          // Shared messages come from the shared thread; local comments keep their native rows.
          const sharedOnly = session.comments().filter(comment => (comment as IComment & { audience?: string }).audience === 'shared_it');
          return [...local, ...sharedOnly].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        },
        createComment: async (comment: IComment, ...rest: unknown[]) => {
          const audience = comment.collaboration_audience;
          if (!viaWriter(audience, comment.parent_comment_id)) return (native.createComment as (...a: unknown[]) => Promise<unknown>)(comment, ...rest);
          try { return (await session!.write({ content: comment.note ?? '', audience: 'shared_it', ...(comment.parent_comment_id ? { parentCommentId: comment.parent_comment_id } : {}) })).comment_id; } catch (error) { return failure(error); }
        },
        addTicketCommentWithCache: addComment(native.addTicketCommentWithCache as never),
        addTicketCommentWithCacheForCurrentUser: addComment(native.addTicketCommentWithCacheForCurrentUser as never),
      },
    } as unknown as TicketDataSourceOverrides);
    // `version` re-derives the audiences once the session has loaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, version]);

  return <TicketDataSourceProvider dataSource={dataSource}>{children}
    {session && resource && <CoManagedConversationFiles session={session} resource={resource} staging={staging} version={version} />}
  </TicketDataSourceProvider>;
}
