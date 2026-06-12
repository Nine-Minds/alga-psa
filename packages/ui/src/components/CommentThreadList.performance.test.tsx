/** @vitest-environment jsdom */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CommentThreadList from './CommentThreadList';
import HybridThreadNode from './HybridThreadNode';

interface PerfComment {
  id: string;
  threadId: string;
  parentId: string | null;
  createdAt: string;
}

function buildComments(): PerfComment[] {
  const comments: PerfComment[] = [];
  for (let threadIndex = 0; threadIndex < 100; threadIndex += 1) {
    const rootId = `thread-${threadIndex}-root`;
    comments.push({
      id: rootId,
      threadId: `thread-${threadIndex}`,
      parentId: null,
      createdAt: `2026-05-13T09:${String(threadIndex % 60).padStart(2, '0')}:00.000Z`,
    });

    for (let replyIndex = 0; replyIndex < 5; replyIndex += 1) {
      comments.push({
        id: `thread-${threadIndex}-reply-${replyIndex}`,
        threadId: `thread-${threadIndex}`,
        parentId: rootId,
        createdAt: `2026-05-13T10:${String(replyIndex).padStart(2, '0')}:00.000Z`,
      });
    }
  }
  return comments;
}

describe('CommentThreadList performance', () => {
  it('T071: renders 100 threads with five replies each within the component budget', () => {
    const comments = buildComments();
    const startedAt = performance.now();

    const { container } = render(
      <CommentThreadList<PerfComment>
        comments={comments}
        getCommentId={(comment) => comment.id}
        getThreadId={(comment) => comment.threadId}
        getParentCommentId={(comment) => comment.parentId}
        getCreatedAt={(comment) => comment.createdAt}
        renderThreadGroup={(group) => (
          <HybridThreadNode<PerfComment>
            key={group.threadId}
            group={group}
            comment={group.root}
            getCommentId={(comment) => comment.id}
            renderComment={(comment) => <div data-testid="perf-comment">{comment.id}</div>}
          />
        )}
      />
    );

    const durationMs = performance.now() - startedAt;

    expect(container.querySelectorAll('[data-testid="perf-comment"]')).toHaveLength(600);
    expect(container.querySelectorAll('.comment-thread-bar')).toHaveLength(100);
    expect(durationMs).toBeLessThan(1500);
  });
});
