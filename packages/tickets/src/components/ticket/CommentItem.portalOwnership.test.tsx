/* @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IComment } from '@alga-psa/types';
import CommentItem from './CommentItem';
import { resolveCommentAuthor } from '../../lib/commentAuthorResolution';

vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: () => <div data-testid="rich-text-viewer" />,
  TextEditor: () => <div data-testid="text-editor" />,
}));
vi.mock('@alga-psa/ui/components/ReactionDisplay', () => ({ ReactionDisplay: () => <div data-testid="reactions" /> }));
vi.mock('@alga-psa/user-composition/actions', () => ({ searchUsersForMentions: vi.fn() }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({ locale: 'en', formatDate: () => 'today', formatNumber: String, formatCurrency: String, formatRelativeTime: String }),
  useTranslation: () => ({ t: (key: string) => key }),
}));

function portalComment(overrides: Partial<IComment>): IComment {
  return {
    tenant: 'tenant-1', author_type: 'unknown', comment_id: 'portal-comment', note: '[]',
    created_at: new Date().toISOString(), is_system_generated: false,
    // This fixture is the UUID-redacted action response shape.
    user_id: undefined, contact_id: undefined, actor_reference_id: undefined,
    portal_author: { name: 'Portal User', role: 'client' }, portal_can_edit: false, portal_can_delete: false,
    ...overrides,
  } as IComment;
}

function renderProjected(comment: IComment, readOnly = false) {
  return render(<CommentItem
    conversation={comment}
    currentUserId="portal-user"
    isEditing={false}
    currentComment={null}
    ticketId="ticket-1"
    userMap={{}}
    contactMap={{}}
    onContentChange={() => {}}
    onSave={() => {}}
    onClose={() => {}}
    {...(!readOnly ? { onEdit: () => {}, onDelete: () => {} } : {})}
  />);
}

function expectControls(commentId: string, enabled: boolean) {
  const edit = screen.queryByRole('button', { name: 'conversation.editCommentAriaLabel' });
  const remove = screen.queryByRole('button', { name: 'conversation.deleteCommentAriaLabel' });
  expect(Boolean(edit)).toBe(enabled);
  expect(Boolean(remove)).toBe(enabled);
  if (enabled) {
    expect(edit).toHaveAttribute('id', `edit-comment-${commentId}-button`);
    expect(remove).toHaveAttribute('id', `delete-comment-${commentId}-button`);
  }
}

describe('client portal projected comment ownership', () => {
  it('renders edit and delete only for a caller-owned projected comment', () => {
    renderProjected(portalComment({ comment_id: 'own', portal_can_edit: true, portal_can_delete: true }));
    expectControls('own', true);
  });

  it('keeps another author, read-only, deleted, system, and collaborator comments protected', () => {
    const protectedComments = [
      portalComment({ comment_id: 'other', portal_author: { name: 'Staff Agent', role: 'staff' } }),
      portalComment({ comment_id: 'readonly', portal_can_edit: true }),
      portalComment({ comment_id: 'deleted', portal_can_edit: true, deleted_at: new Date().toISOString() }),
      portalComment({ comment_id: 'system', portal_can_edit: true, is_system_generated: true, portal_author: { name: 'System', role: 'system' } }),
      portalComment({ comment_id: 'collaborator', portal_can_edit: true, portal_author: { name: 'Taylor Tech (Partner Co)', role: 'collaborator' } }),
    ];
    for (const comment of protectedComments) {
      const readOnly = comment.comment_id === 'readonly';
      const { unmount } = renderProjected(comment, readOnly);
      expectControls(comment.comment_id!, false);
      unmount();
    }
  });

  it('preserves staff, client, contact, system, and collaborator author categories without identity maps', () => {
    const cases = [
      [portalComment({ portal_author: { name: 'Staff Agent', role: 'staff' } }), 'user', 'internal'],
      [portalComment({ portal_author: { name: 'Client User', role: 'client' } }), 'user', 'client'],
      [portalComment({ portal_author: { name: 'Contact Person', role: 'contact' } }), 'contact', 'client'],
      [portalComment({ portal_author: { name: 'Automation', role: 'service' } }), 'user', 'service'],
      [portalComment({ portal_author: { name: 'System', role: 'system' }, is_system_generated: true }), 'system', undefined],
      [portalComment({ portal_author: { name: 'Taylor Tech (Partner Co)', role: 'collaborator' } }), 'collaborator', undefined],
    ] as const;
    for (const [comment, source, kind] of cases) {
      const author = resolveCommentAuthor(comment, { userMap: {}, contactMap: {} });
      expect(author.source).toBe(source);
      expect(author.authorKind).toBe(kind);
      expect(author.userId).toBeUndefined();
      expect(author.contactId).toBeUndefined();
      expect(author.email).toBeUndefined();
    }
  });
});
