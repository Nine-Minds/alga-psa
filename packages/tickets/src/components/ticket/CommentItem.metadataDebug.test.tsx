/* @vitest-environment jsdom */

import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { IComment } from '@alga-psa/types';
import CommentItem from './CommentItem';

vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: () => <div data-testid="rich-text-viewer" />,
  TextEditor: () => <div data-testid="text-editor" />,
}));

vi.mock('@alga-psa/ui/components/ReactionDisplay', () => ({
  ReactionDisplay: ({ reactions, onToggle }: any) => (
    <div>
      {reactions.map((reaction: any) => (
        <button
          key={reaction.emoji}
          type="button"
          onClick={() => onToggle(reaction.emoji)}
        >
          {reaction.emoji} {reaction.count} reaction
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  searchUsersForMentions: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, defaultValue: string) => defaultValue,
  }),
}));

const NOTE = JSON.stringify([
  {
    type: 'paragraph',
    props: {
      textAlignment: 'left',
      backgroundColor: 'default',
      textColor: 'default',
    },
    content: [{ type: 'text', text: 'Hi', styles: {} }],
  },
]);

function buildComment(overrides: Partial<IComment>): IComment {
  return {
    tenant: 'tenant-1',
    author_type: 'internal',
    comment_id: 'comment-1',
    user_id: 'user-1',
    note: NOTE,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const userMap = {
  'user-1': {
    user_id: 'user-1',
    first_name: 'A',
    last_name: 'User',
    email: 'a@example.com',
    user_type: 'internal',
    avatarUrl: null,
  },
};

describe('CommentItem metadata debug control', () => {
  it('T053: wires Reply in the hover/focus action row and keeps c-actions reveal CSS', async () => {
    const user = userEvent.setup();
    const onReply = vi.fn();

    render(
      <CommentItem
        conversation={buildComment({})}
        currentUserId="other"
        isEditing={false}
        currentComment={null}
        ticketId="t1"
        userMap={userMap}
        contactMap={{}}
        onContentChange={() => {}}
        onSave={() => {}}
        onClose={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onReply={onReply}
      />
    );

    const replyButton = screen.getByRole('button', { name: 'Reply to comment' });
    expect(replyButton.closest('.c-actions')).not.toBeNull();

    await user.click(replyButton);
    expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 'comment-1' }));

    const css = fs.readFileSync(
      path.resolve(__dirname, '../../../../ui/src/components/CommentThread.css'),
      'utf8'
    );
    expect(css).toContain('.c-actions');
    expect(css).toContain('opacity: 0;');
    expect(css).toContain('.group\\/comment:hover .c-actions');
    expect(css).toContain('.group\\/comment:focus-within .c-actions');
    expect(css).toContain('opacity: 1;');
  });

  it('T054: renders a soft-deleted ticket comment as a placeholder without Reply', () => {
    render(
      <CommentItem
        conversation={buildComment({ deleted_at: new Date().toISOString(), note: '[deleted]' })}
        currentUserId="user-1"
        isEditing={false}
        currentComment={null}
        ticketId="t1"
        userMap={userMap}
        contactMap={{}}
        onContentChange={() => {}}
        onSave={() => {}}
        onClose={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onReply={() => {}}
      />
    );

    const deletedPlaceholder = screen.getByText('[deleted]');
    expect(deletedPlaceholder).toHaveClass('opacity-70');
    expect(screen.queryByRole('button', { name: 'Reply to comment' })).not.toBeInTheDocument();
  });

  it('T069: saves a legacy edited comment without threading fields while model advances updated_at', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const legacyComment = buildComment({
      thread_id: undefined,
      parent_comment_id: undefined,
      updated_at: undefined,
    });

    render(
      <CommentItem
        conversation={legacyComment}
        currentUserId="user-1"
        isEditing={true}
        currentComment={legacyComment}
        ticketId="t1"
        userMap={userMap}
        contactMap={{}}
        onContentChange={() => {}}
        onSave={onSave}
        onClose={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onReply={() => {}}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      note: expect.any(String),
      is_internal: false,
      is_resolution: false,
    }));
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('thread_id');
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('parent_comment_id');

    const modelSource = fs.readFileSync(
      path.resolve(__dirname, '../../models/comment.ts'),
      'utf8'
    );
    expect(modelSource).toContain('updated_at: new Date().toISOString()');
  });

  it('T070: keeps reactions wired to reply comment ids', async () => {
    const user = userEvent.setup();
    const onToggleReaction = vi.fn();

    render(
      <CommentItem
        conversation={buildComment({
          comment_id: 'reply-1',
          thread_id: 'thread-1',
          parent_comment_id: 'root-1',
        })}
        currentUserId="user-1"
        isEditing={false}
        currentComment={null}
        ticketId="t1"
        userMap={userMap}
        contactMap={{}}
        onContentChange={() => {}}
        onSave={() => {}}
        onClose={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onReply={() => {}}
        reactions={[{
          emoji: '👍',
          count: 1,
          userIds: ['user-1'],
          currentUserReacted: true,
        }]}
        onToggleReaction={onToggleReaction}
        userNames={{ 'user-1': 'A User' }}
      />
    );

    await user.click(screen.getByRole('button', { name: '👍 1 reaction' }));

    expect(onToggleReaction).toHaveBeenCalledWith('reply-1', '👍');
  });

  it('hides the metadata control without Admin Settings access or when metadata is empty', () => {
    const { rerender } = render(
      <CommentItem
        conversation={buildComment({ metadata: { k: 1 } })}
        currentUserId="other"
        isEditing={false}
        currentComment={null}
        ticketId="t1"
        userMap={userMap}
        contactMap={{}}
        onContentChange={() => {}}
        onSave={() => {}}
        onClose={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        canViewCommentMetadataDebug={false}
      />
    );

    expect(screen.queryByRole('button', { name: 'View metadata (debug)' })).not.toBeInTheDocument();

    rerender(
      <CommentItem
        conversation={buildComment({ metadata: {} })}
        currentUserId="other"
        isEditing={false}
        currentComment={null}
        ticketId="t1"
        userMap={userMap}
        contactMap={{}}
        onContentChange={() => {}}
        onSave={() => {}}
        onClose={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        canViewCommentMetadataDebug
      />
    );

    expect(screen.queryByRole('button', { name: 'View metadata (debug)' })).not.toBeInTheDocument();
  });

  it('shows the metadata control when permitted and metadata is non-empty, and opens the dialog', async () => {
    const user = userEvent.setup();

    render(
      <CommentItem
        conversation={buildComment({
          metadata: { responseSource: 'inbound_email', email: { provider: 'google' } },
        })}
        currentUserId="other"
        isEditing={false}
        currentComment={null}
        ticketId="t1"
        userMap={userMap}
        contactMap={{}}
        onContentChange={() => {}}
        onSave={() => {}}
        onClose={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        canViewCommentMetadataDebug
      />
    );

    const trigger = screen.getByRole('button', { name: 'View metadata (debug)' });
    await user.click(trigger);

    expect(screen.getByText('email.provider')).toBeInTheDocument();
    expect(screen.getByText('google')).toBeInTheDocument();
  });
});
