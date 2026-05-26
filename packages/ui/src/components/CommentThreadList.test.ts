/* @vitest-environment node */

import { describe, expect, it } from 'vitest';
import { buildCommentThreadGroups } from './CommentThreadList';

interface TestComment {
  id: string;
  threadId: string;
  parentId: string | null;
  createdAt: string;
  threadLastActivityAt?: string;
}

function group(comments: TestComment[], newestFirst = false) {
  return buildCommentThreadGroups<TestComment>({
    comments,
    newestFirst,
    getCommentId: (comment) => comment.id,
    getThreadId: (comment) => comment.threadId,
    getParentCommentId: (comment) => comment.parentId,
    getCreatedAt: (comment) => comment.createdAt,
    getThreadLastActivityAt: (threadComments) => threadComments[0]?.threadLastActivityAt,
  });
}

describe('CommentThreadList grouping', () => {
  it('T045: groups comments into threads and sorts by last activity with newestFirst support', () => {
    const comments: TestComment[] = [
      {
        id: 'root-a',
        threadId: 'thread-a',
        parentId: null,
        createdAt: '2026-05-13T09:00:00.000Z',
        threadLastActivityAt: '2026-05-13T12:00:00.000Z',
      },
      {
        id: 'reply-a',
        threadId: 'thread-a',
        parentId: 'root-a',
        createdAt: '2026-05-13T09:15:00.000Z',
      },
      {
        id: 'root-b',
        threadId: 'thread-b',
        parentId: null,
        createdAt: '2026-05-13T10:00:00.000Z',
        threadLastActivityAt: '2026-05-13T11:00:00.000Z',
      },
      {
        id: 'reply-b',
        threadId: 'thread-b',
        parentId: 'root-b',
        createdAt: '2026-05-13T10:15:00.000Z',
      },
    ];

    const oldestFirstGroups = group(comments);
    expect(oldestFirstGroups.map((thread) => thread.threadId)).toEqual(['thread-b', 'thread-a']);
    expect(oldestFirstGroups[1].root.id).toBe('root-a');
    expect(oldestFirstGroups[1].replyCount).toBe(1);
    expect(oldestFirstGroups[1].childrenByParentId.get('root-a')?.map((comment) => comment.id)).toEqual([
      'reply-a',
    ]);

    const newestFirstGroups = group(comments, true);
    expect(newestFirstGroups.map((thread) => thread.threadId)).toEqual(['thread-a', 'thread-b']);
    expect(newestFirstGroups[0].comments.map((comment) => comment.id)).toEqual(['root-a', 'reply-a']);
  });
});
