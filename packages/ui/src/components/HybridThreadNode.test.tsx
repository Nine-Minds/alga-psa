/** @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildCommentThreadGroups } from './CommentThreadList';
import CommentThreadDrawer from './CommentThreadDrawer';
import HybridThreadNode from './HybridThreadNode';

vi.mock('../editor', () => ({
  TextEditor: () => <textarea aria-label="Reply editor" />,
}));

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

    expect(screen.getByTestId('comment-root')).toHaveAttribute('data-subthread', 'false');
    expect(screen.getByTestId('comment-root')).toHaveAttribute('data-depth', '0');
    expect(screen.getByTestId('comment-root')).toHaveAttribute('data-has-children', 'true');

    expect(screen.getByTestId('comment-reply')).toHaveAttribute('data-subthread', 'true');
    expect(screen.getByTestId('comment-reply')).toHaveAttribute('data-depth', '1');
    expect(screen.getByTestId('comment-reply')).toHaveAttribute('data-has-children', 'true');

    expect(screen.getByTestId('comment-subreply')).toHaveAttribute('data-subthread', 'true');
    expect(screen.getByTestId('comment-subreply')).toHaveAttribute('data-depth', '2');
    expect(screen.getByTestId('comment-subreply')).toHaveAttribute('data-has-children', 'false');
  });

  it('T047: collapsing a thread hides children and switches the bar to Expand and Open in drawer', () => {
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

    expect(screen.getByTestId('comment-reply')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Collapse' })[0]);

    expect(screen.queryByTestId('comment-reply')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open in drawer' })).toBeInTheDocument();
  });

  it('T048: clicking Open in drawer opens the drawer with the selected root and replies', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Open in drawer' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('drawer-comment-root')).toBeInTheDocument();
    expect(within(dialog).getByTestId('drawer-comment-reply')).toBeInTheDocument();
    expect(within(dialog).getByTestId('drawer-comment-subreply')).toBeInTheDocument();
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
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('inline-comment-drawer-reply')).toBeInTheDocument();
  });
});
