/** @vitest-environment jsdom */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCommentThreadGroups } from './CommentThreadList';
import CommentThreadDrawer from './CommentThreadDrawer';
import HybridThreadNode from './HybridThreadNode';

vi.mock('../editor', () => ({
  TextEditor: () => <textarea aria-label="Reply editor" />,
}));

afterEach(() => {
  cleanup();
});

interface TestComment {
  id: string;
  threadId: string;
  parentId: string | null;
  createdAt: string;
}

const comments: TestComment[] = [
  { id: 'root', threadId: 'thread-1', parentId: null, createdAt: '2026-05-13T09:00:00.000Z' },
  { id: 'reply', threadId: 'thread-1', parentId: 'root', createdAt: '2026-05-13T09:05:00.000Z' },
  { id: 'subreply', threadId: 'thread-1', parentId: 'reply', createdAt: '2026-05-13T09:10:00.000Z' },
];

function buildGroup() {
  return buildCommentThreadGroups<TestComment>({
    comments,
    getCommentId: (comment) => comment.id,
    getThreadId: (comment) => comment.threadId,
    getParentCommentId: (comment) => comment.parentId,
    getCreatedAt: (comment) => comment.createdAt,
  })[0];
}

describe('HybridThreadNode', () => {
  it('T046: renders child threads recursively and marks nested levels as sub-threads', () => {
    const group = buildGroup();

    render(
      <HybridThreadNode<TestComment>
        group={group}
        comment={group.root}
        getCommentId={(comment) => comment.id}
        renderComment={(comment, context) => (
          <div
            data-testid={`comment-${comment.id}`}
            data-depth={context.depth}
            data-visual-depth={context.visualDepth}
            data-subthread={String(context.isSubThread)}
            data-has-children={String(context.hasChildren)}
          >
            {comment.id}
          </div>
        )}
      />
    );

    expect(screen.getByTestId('comment-root').getAttribute('data-subthread')).toBe('false');
    expect(screen.getByTestId('comment-root').getAttribute('data-depth')).toBe('0');
    expect(screen.getByTestId('comment-root').getAttribute('data-has-children')).toBe('true');

    expect(screen.getByTestId('comment-reply').getAttribute('data-subthread')).toBe('true');
    expect(screen.getByTestId('comment-reply').getAttribute('data-depth')).toBe('1');
    expect(screen.getByTestId('comment-reply').getAttribute('data-has-children')).toBe('true');

    expect(screen.getByTestId('comment-subreply').getAttribute('data-subthread')).toBe('true');
    expect(screen.getByTestId('comment-subreply').getAttribute('data-depth')).toBe('2');
    expect(screen.getByTestId('comment-subreply').getAttribute('data-has-children')).toBe('false');
  });

  it('T047: collapsing a thread hides children and switches the bar to Expand and Show in drawer', () => {
    const group = buildGroup();

    render(
      <HybridThreadNode<TestComment>
        group={group}
        comment={group.root}
        getCommentId={(comment) => comment.id}
        onOpenPanel={() => undefined}
        renderComment={(comment) => <div data-testid={`comment-${comment.id}`}>{comment.id}</div>}
      />
    );

    expect(screen.getByTestId('comment-reply')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Collapse' })[0]);

    expect(screen.queryByTestId('comment-reply')).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show in drawer' })).toBeTruthy();
  });

  it('T048: clicking Show in drawer opens the drawer with the selected root and replies', () => {
    const group = buildGroup();

    function Harness() {
      const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);
      return (
        <>
          <HybridThreadNode<TestComment>
            group={group}
            comment={group.root}
            getCommentId={(comment) => comment.id}
            onOpenPanel={() => setIsDrawerOpen(true)}
            renderComment={(comment) => <div data-testid={`inline-comment-${comment.id}`}>{comment.id}</div>}
          />
          <CommentThreadDrawer<TestComment>
            isOpen={isDrawerOpen}
            onClose={() => setIsDrawerOpen(false)}
            group={isDrawerOpen ? group : null}
            getCommentId={(comment) => comment.id}
            replyRoomName={(parentCommentId) => `reply-${parentCommentId}`}
            onSubmitReply={() => undefined}
            renderComment={(comment) => <div data-testid={`drawer-comment-${comment.id}`}>{comment.id}</div>}
          />
        </>
      );
    }

    render(<Harness />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Collapse' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Show in drawer' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('drawer-comment-root')).toBeTruthy();
    expect(within(dialog).getByTestId('drawer-comment-reply')).toBeTruthy();
    expect(within(dialog).getByTestId('drawer-comment-subreply')).toBeTruthy();
  });

  it('T050: drawer composer submits with the parent id, closes, and refreshes inline replies', () => {
    const onSubmit = vi.fn();

    function Harness() {
      const [isDrawerOpen, setIsDrawerOpen] = React.useState(false);
      const [threadComments, setThreadComments] = React.useState<TestComment[]>([
        { id: 'root', threadId: 'thread-1', parentId: null, createdAt: '2026-05-13T09:00:00.000Z' },
      ]);
      const group = buildCommentThreadGroups<TestComment>({
        comments: threadComments,
        getCommentId: (comment) => comment.id,
        getThreadId: (comment) => comment.threadId,
        getParentCommentId: (comment) => comment.parentId,
        getCreatedAt: (comment) => comment.createdAt,
      })[0];

      return (
        <>
          <button type="button" onClick={() => setIsDrawerOpen(true)}>
            Open drawer
          </button>
          <HybridThreadNode<TestComment>
            group={group}
            comment={group.root}
            getCommentId={(comment) => comment.id}
            renderComment={(comment) => <div data-testid={`inline-comment-${comment.id}`}>{comment.id}</div>}
          />
          <CommentThreadDrawer<TestComment>
            isOpen={isDrawerOpen}
            onClose={() => setIsDrawerOpen(false)}
            group={isDrawerOpen ? group : null}
            getCommentId={(comment) => comment.id}
            replyParentCommentId="root"
            replyRoomName={(parentCommentId) => `reply-${parentCommentId}`}
            showInternalToggle={false}
            onSubmitReply={(params) => {
              onSubmit(params);
              setThreadComments((currentComments) => [
                ...currentComments,
                {
                  id: 'drawer-reply',
                  threadId: 'thread-1',
                  parentId: params.parentCommentId,
                  createdAt: '2026-05-13T09:05:00.000Z',
                },
              ]);
              setIsDrawerOpen(false);
            }}
            renderComment={(comment) => <div data-testid={`drawer-comment-${comment.id}`}>{comment.id}</div>}
          />
        </>
      );
    }

    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reply' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      parentCommentId: 'root',
    }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('inline-comment-drawer-reply')).toBeTruthy();
  });

  it('T051: caps visual indentation at depth 4 while rendering deeper data', () => {
    const deepComments: TestComment[] = [
      { id: 'root', threadId: 'thread-1', parentId: null, createdAt: '2026-05-13T09:00:00.000Z' },
      { id: 'depth-1', threadId: 'thread-1', parentId: 'root', createdAt: '2026-05-13T09:01:00.000Z' },
      { id: 'depth-2', threadId: 'thread-1', parentId: 'depth-1', createdAt: '2026-05-13T09:02:00.000Z' },
      { id: 'depth-3', threadId: 'thread-1', parentId: 'depth-2', createdAt: '2026-05-13T09:03:00.000Z' },
      { id: 'depth-4', threadId: 'thread-1', parentId: 'depth-3', createdAt: '2026-05-13T09:04:00.000Z' },
      { id: 'depth-5', threadId: 'thread-1', parentId: 'depth-4', createdAt: '2026-05-13T09:05:00.000Z' },
    ];
    const group = buildCommentThreadGroups<TestComment>({
      comments: deepComments,
      getCommentId: (comment) => comment.id,
      getThreadId: (comment) => comment.threadId,
      getParentCommentId: (comment) => comment.parentId,
      getCreatedAt: (comment) => comment.createdAt,
    })[0];

    const { container } = render(
      <HybridThreadNode<TestComment>
        group={group}
        comment={group.root}
        getCommentId={(comment) => comment.id}
        renderComment={(comment, context) => (
          <div
            data-testid={`comment-${comment.id}`}
            data-depth={context.depth}
            data-visual-depth={context.visualDepth}
          >
            {comment.id}
          </div>
        )}
      />
    );

    expect(screen.getByTestId('comment-depth-5').getAttribute('data-depth')).toBe('5');
    expect(screen.getByTestId('comment-depth-5').getAttribute('data-visual-depth')).toBe('4');
    expect(container.querySelectorAll('.thread-children.depth-4').length).toBeGreaterThanOrEqual(2);
  });

  it('T052: marks nested thread bars as dashed sub-thread bars while root bars use the base style', () => {
    const group = buildGroup();

    const { container } = render(
      <HybridThreadNode<TestComment>
        group={group}
        comment={group.root}
        getCommentId={(comment) => comment.id}
        renderComment={(comment) => <div data-testid={`comment-${comment.id}`}>{comment.id}</div>}
      />
    );

    const bars = container.querySelectorAll('.comment-thread-bar');
    expect(bars).toHaveLength(2);
    expect(bars[0].classList.contains('depth-0')).toBe(true);
    expect(bars[0].classList.contains('comment-thread-bar-subthread')).toBe(false);
    expect(bars[1].classList.contains('depth-1')).toBe(true);
    expect(bars[1].classList.contains('comment-thread-bar-subthread')).toBe(true);

    // jsdom rewrites import.meta.url to an http URL, so resolve from cwd,
    // tolerating either the package dir or the repo root as the working dir.
    const cssPath = [
      'src/components/CommentThread.css',
      'packages/ui/src/components/CommentThread.css',
    ]
      .map((candidate) => resolve(process.cwd(), candidate))
      .find(existsSync);
    if (!cssPath) {
      throw new Error(`CommentThread.css not found from ${process.cwd()}`);
    }
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toContain('background: rgb(var(--color-border-50));');
    expect(css).toContain('.comment-thread-bar-subthread');
    expect(css).toContain('border-style: dashed;');
    expect(css).toContain('background: rgb(var(--color-background));');
  });
});
