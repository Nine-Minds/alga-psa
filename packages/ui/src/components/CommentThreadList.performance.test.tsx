/** @vitest-environment jsdom */

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CommentThreadList from './CommentThreadList';
import HybridThreadNode from './HybridThreadNode';

interface PerfComment {
  id: string;
  threadId: string;
  parentId: string | null;
  createdAt: string;
}

const THREAD_COUNT = 100;
const BASELINE_THREAD_COUNT = 10;
const SAMPLES = 3;
// The render cost has to stay proportional to the thread count. Ten times the
// threads may cost ten times the time; a super-linear regression in grouping or
// nesting drives the ratio toward a hundred. The slack absorbs the fixed
// per-render overhead the small baseline pays proportionally more of.
const MAX_SCALING_FACTOR = 25;

function buildComments(threadCount: number): PerfComment[] {
  const comments: PerfComment[] = [];
  for (let threadIndex = 0; threadIndex < threadCount; threadIndex += 1) {
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

function renderThreads(comments: PerfComment[]) {
  return render(
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
}

function measureRenderMs(comments: PerfComment[], threadCount: number): number {
  const startedAt = performance.now();
  const { container } = renderThreads(comments);
  const durationMs = performance.now() - startedAt;

  expect(container.querySelectorAll('[data-testid="perf-comment"]')).toHaveLength(threadCount * 6);
  expect(container.querySelectorAll('.comment-thread-bar')).toHaveLength(threadCount);
  cleanup();
  return durationMs;
}

// The fastest sample is the one least polluted by GC pauses and CI-runner
// scheduling noise, which is what makes the ratio comparable across machines.
function fastestRenderMs(threadCount: number): number {
  const comments = buildComments(threadCount);
  let fastest = Number.POSITIVE_INFINITY;
  for (let sample = 0; sample < SAMPLES; sample += 1) {
    fastest = Math.min(fastest, measureRenderMs(comments, threadCount));
  }
  return fastest;
}

describe('CommentThreadList performance', () => {
  it('T071: renders 100 threads with five replies each without super-linear cost', () => {
    // Warm up before measuring: the first render pays module init and JIT costs
    // that dwarf the steady state this asserts.
    measureRenderMs(buildComments(BASELINE_THREAD_COUNT), BASELINE_THREAD_COUNT);

    // Calibrate against this machine instead of a wall-clock ceiling: a shared
    // CI runner is an order of magnitude slower than a dev laptop, so an
    // absolute budget measures the runner, not the component.
    const baselineMs = fastestRenderMs(BASELINE_THREAD_COUNT);
    const fullMs = fastestRenderMs(THREAD_COUNT);

    expect(fullMs / baselineMs).toBeLessThan(MAX_SCALING_FACTOR);
  }, 60_000);
});
