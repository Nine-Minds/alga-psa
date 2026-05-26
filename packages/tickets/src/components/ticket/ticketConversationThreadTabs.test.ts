import { describe, expect, it } from 'vitest';
import type { IComment } from '@alga-psa/types';
import { buildCommentThreadGroups } from '@alga-psa/ui/components';
import { buildTicketThreadTabState } from './ticketConversationThreadTabs';

function comment(overrides: Partial<IComment> & Pick<IComment, 'comment_id'>): IComment {
  return {
    tenant: 'tenant-1',
    author_type: 'internal',
    user_id: 'user-1',
    note: '[]',
    created_at: '2026-05-13T09:00:00.000Z',
    ...overrides,
  };
}

function buildGroups(comments: IComment[]) {
  return buildCommentThreadGroups<IComment>({
    comments,
    getCommentId: (item) => item.comment_id,
    getThreadId: (item) => item.thread_id || item.comment_id,
    getParentCommentId: (item) => item.parent_comment_id,
    getCreatedAt: (item) => item.created_at,
  });
}

describe('ticket conversation thread tabs', () => {
  it('T055: computes tab counts and filtered comments at thread granularity', () => {
    const groups = buildGroups([
      comment({ comment_id: 'client-root', thread_id: 'client-thread', is_internal: false }),
      comment({
        comment_id: 'client-reply-resolution',
        thread_id: 'client-thread',
        parent_comment_id: 'client-root',
        is_internal: false,
        is_resolution: true,
        created_at: '2026-05-13T09:01:00.000Z',
      }),
      comment({ comment_id: 'internal-root', thread_id: 'internal-thread', is_internal: true }),
      comment({
        comment_id: 'internal-reply-resolution',
        thread_id: 'internal-thread',
        parent_comment_id: 'internal-root',
        is_internal: true,
        is_resolution: true,
        created_at: '2026-05-13T09:02:00.000Z',
      }),
      comment({ comment_id: 'client-root-2', thread_id: 'client-thread-2', is_internal: false }),
    ]);

    const state = buildTicketThreadTabState(groups, false);

    expect(state.counts).toEqual({
      all: 3,
      client: 2,
      internal: 1,
      resolution: 2,
    });
    expect(state.clientTabComments.map((item) => item.comment_id)).toEqual([
      'client-root-2',
      'client-root',
      'client-reply-resolution',
    ]);
    expect(state.internalTabComments.map((item) => item.comment_id)).toEqual([
      'internal-root',
      'internal-reply-resolution',
    ]);
    expect(state.resolutionTabComments.map((item) => item.comment_id)).toEqual([
      'client-root',
      'client-reply-resolution',
      'internal-root',
      'internal-reply-resolution',
    ]);

    const clientPortalState = buildTicketThreadTabState(groups, true);
    expect(clientPortalState.counts).toEqual({
      all: 2,
      client: 2,
      internal: 1,
      resolution: 1,
    });
    expect(clientPortalState.allTabComments.map((item) => item.comment_id)).toEqual([
      'client-root-2',
      'client-root',
      'client-reply-resolution',
    ]);
    expect(clientPortalState.resolutionTabComments.map((item) => item.comment_id)).toEqual([
      'client-root',
      'client-reply-resolution',
    ]);
  });
});
