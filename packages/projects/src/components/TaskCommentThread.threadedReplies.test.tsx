/** @vitest-environment jsdom */

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaskCommentThread from './TaskCommentThread';
import type { IProjectTaskCommentWithUser } from '@alga-psa/types';

const NOTE = JSON.stringify([
  {
    type: 'paragraph',
    content: [{ type: 'text', text: 'Task comment', styles: {} }],
  },
]);

const taskStore = vi.hoisted(() => ({
  comments: [] as IProjectTaskCommentWithUser[],
}));

vi.mock('@alga-psa/ui/editor', () => ({
  DEFAULT_BLOCK: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '', styles: {} }],
    },
  ],
  RichTextViewer: () => <div data-testid="rich-text-viewer" />,
  TextEditor: ({ editorRef }: any) => {
    if (editorRef) {
      editorRef.current = {
        document: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Reply body', styles: {} }],
          },
        ],
        replaceBlocks: vi.fn(),
      };
    }
    return <div data-testid="task-comment-editor" />;
  },
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/UserAvatar', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/ReactionDisplay', () => ({
  ReactionDisplay: () => null,
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ 'data-testid': id }),
  withUIReflectionId: ({ id }: { id: string }) => ({ 'data-testid': id }),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({
    user_id: 'user-1',
    first_name: 'A',
    last_name: 'User',
  }),
  getCurrentUserAvatarUrl: vi.fn().mockResolvedValue(null),
  searchUsersForMentions: vi.fn(),
}));

vi.mock('../actions/projectTaskCommentReactionActions', () => ({
  getTaskCommentsReactionsBatch: vi.fn().mockResolvedValue({ reactions: {}, userNames: {} }),
  toggleTaskCommentReaction: vi.fn(),
}));

vi.mock('../actions/projectTaskCommentActions', () => ({
  getTaskComments: vi.fn(async () => taskStore.comments),
  createTaskComment: vi.fn(async (input: { taskId: string; note: string; parent_comment_id?: string | null }) => {
    taskStore.comments = [
      ...taskStore.comments,
      buildTaskComment({
        taskCommentId: 'reply-1',
        threadId: 'thread-1',
        parentCommentId: input.parent_comment_id ?? null,
        note: input.note,
        createdAt: '2026-05-13T09:05:00.000Z',
      }),
    ];
  }),
  updateTaskComment: vi.fn(),
  deleteTaskComment: vi.fn(),
}));

function buildTaskComment(
  overrides: Partial<IProjectTaskCommentWithUser> = {}
): IProjectTaskCommentWithUser {
  return {
    taskCommentId: 'root',
    taskId: 'task-1',
    userId: 'user-1',
    note: NOTE,
    createdAt: '2026-05-13T09:00:00.000Z',
    updatedAt: null,
    editedAt: null,
    firstName: 'A',
    lastName: 'User',
    email: 'a@example.com',
    avatarUrl: null,
    author_type: 'internal',
    threadId: 'thread-1',
    parentCommentId: null,
    deletedAt: null,
    ...overrides,
  } as IProjectTaskCommentWithUser;
}

describe('TaskCommentThread threaded replies', () => {
  beforeEach(() => {
    taskStore.comments = [buildTaskComment()];
    vi.clearAllMocks();
  });

  it('T064: opens an inline reply composer and submits an indented child reply', async () => {
    const user = userEvent.setup();

    render(<TaskCommentThread taskId="task-1" projectId="project-1" />);

    expect(await screen.findByTestId('task-comment-root')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reply to comment' }));

    expect(screen.getByTestId('task-comment-editor')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reply' }));

    expect(await screen.findByTestId('task-comment-reply-1')).toBeInTheDocument();
    expect(screen.getByText('1 reply')).toBeInTheDocument();
    expect(screen.getByTestId('task-comment-reply-1').closest('.thread-children')).toHaveClass('depth-1');
  });

  it('T065: collapses a task thread and opens the thread drawer', async () => {
    const user = userEvent.setup();
    taskStore.comments = [
      buildTaskComment(),
      buildTaskComment({
        taskCommentId: 'reply-1',
        parentCommentId: 'root',
        createdAt: '2026-05-13T09:05:00.000Z',
      }),
    ];

    render(<TaskCommentThread taskId="task-1" projectId="project-1" />);

    expect(await screen.findByTestId('task-comment-reply-1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse' }));

    expect(screen.queryByTestId('task-comment-reply-1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show in drawer' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show in drawer' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('task-comment-root')).toBeInTheDocument();
    expect(within(dialog).getByTestId('task-comment-reply-1')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
  });

  it('T066: omits the internal visibility toggle from the task reply composer', async () => {
    const user = userEvent.setup();

    render(<TaskCommentThread taskId="task-1" projectId="project-1" />);

    expect(await screen.findByTestId('task-comment-root')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reply to comment' }));

    expect(screen.getByTestId('task-comment-editor')).toBeInTheDocument();
    expect(screen.queryByText('Mark as Internal')).not.toBeInTheDocument();
  });

  it('T068: legacy flat task comments render without thread bars or indentation', async () => {
    taskStore.comments = [
      buildTaskComment({
        taskCommentId: 'legacy-1',
        threadId: undefined,
        parentCommentId: undefined,
        createdAt: '2026-05-13T09:00:00.000Z',
      }),
      buildTaskComment({
        taskCommentId: 'legacy-2',
        threadId: undefined,
        parentCommentId: undefined,
        createdAt: '2026-05-13T09:05:00.000Z',
      }),
    ];

    const { container } = render(<TaskCommentThread taskId="task-1" projectId="project-1" />);

    expect(await screen.findByTestId('task-comment-legacy-1')).toBeInTheDocument();
    expect(screen.getByTestId('task-comment-legacy-2')).toBeInTheDocument();
    expect(container.querySelector('.comment-thread-bar')).toBeNull();
    expect(container.querySelector('.thread-children')).toBeNull();
  });
});
