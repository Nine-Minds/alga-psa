/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest';

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TaskComment from './TaskComment';
import type { IProjectTaskCommentWithUser } from '@alga-psa/types';

vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: () => <div data-testid="rich-text-viewer" />,
  TextEditor: () => <div data-testid="text-editor" />,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  searchUsersForMentions: vi.fn(),
  getCurrentUserAvatarUrl: vi.fn().mockResolvedValue(null),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue: string) => defaultValue,
  }),
}));

vi.mock('../actions/projectTaskCommentActions', () => ({
  updateTaskComment: vi.fn(),
  deleteTaskComment: vi.fn(),
}));

function buildTaskComment(overrides: Partial<IProjectTaskCommentWithUser> = {}): IProjectTaskCommentWithUser {
  return {
    taskCommentId: 'task-comment-1',
    taskId: 'task-1',
    userId: 'user-1',
    note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Hi', styles: {} }] }]),
    createdAt: new Date().toISOString(),
    updatedAt: null,
    editedAt: null,
    firstName: 'A',
    lastName: 'User',
    email: 'a@example.com',
    avatarUrl: null,
    author_type: 'internal',
    ...overrides,
  } as IProjectTaskCommentWithUser;
}

describe('TaskComment', () => {
  it('T054: renders a soft-deleted task comment as a placeholder without Reply', () => {
    render(
      <TaskComment
        comment={buildTaskComment({ deletedAt: new Date().toISOString(), note: '[deleted]' })}
        currentUserId="user-1"
        onUpdate={() => undefined}
        onDelete={() => undefined}
        onReply={() => undefined}
      />
    );

    const deletedPlaceholder = screen.getByText('[deleted]');
    expect(deletedPlaceholder).toHaveClass('opacity-70');
    expect(screen.queryByRole('button', { name: 'Reply to comment' })).not.toBeInTheDocument();
  });
});
