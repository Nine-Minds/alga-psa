/* @vitest-environment jsdom */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IComment } from '@alga-psa/types';
import CommentItem from './CommentItem';

vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: () => <div data-testid="rich-text-viewer" />,
  TextEditor: () => <div data-testid="text-editor" />,
}));

vi.mock('@alga-psa/ui/components/ReactionDisplay', () => ({
  ReactionDisplay: () => <div data-testid="reactions" />,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  searchUsersForMentions: vi.fn(),
}));

const translations: Record<string, string> = {
  'conversation.unknownUser': 'Unknown User',
  'conversation.editCommentAriaLabel': 'Edit comment',
};

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({
    locale: 'en',
    formatDate: (date: Date | string, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en', options).format(typeof date === 'string' ? new Date(date) : date),
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en', options).format(value),
    formatCurrency: (value: number, currency: string, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en', { style: 'currency', currency, ...options }).format(value),
    formatRelativeTime: (date: Date | string) => String(date),
  }),
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => translations[key] ?? defaultValue ?? key,
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
    author_type: 'unknown',
    comment_id: 'comment-1',
    user_id: null,
    note: NOTE,
    created_at: new Date().toISOString(),
    ...overrides,
  } as IComment;
}

function commentElement(comment: IComment, userMap: Record<string, any> = {}, variant?: 'default' | 'compact') {
  const props = {
    conversation: comment,
    currentUserId: 'user-1',
    isEditing: false,
    currentComment: null,
    ticketId: 't1',
    userMap,
    contactMap: {},
    onContentChange: () => {},
    onSave: () => {},
    onClose: () => {},
    onEdit: () => {},
    onDelete: () => {},
    variant,
  };
  return <CommentItem {...props} />;
}

function renderComment(comment: IComment, userMap: Record<string, any> = {}, variant?: 'default' | 'compact') {
  return render(commentElement(comment, userMap, variant));
}

const FOREIGN = {
  actor_reference_id: 'ref-1',
  actor_display_name: 'Morgan Provider',
  actor_organization_name: 'Partner MSP',
};

describe('CommentItem collaborator attribution', () => {
  it('names the foreign author from the saved snapshot, never "null null"', () => {
    renderComment(buildComment({ author_type: 'internal', ...FOREIGN }));
    expect(screen.getByText('Morgan Provider (Partner MSP)')).toBeInTheDocument();
    expect(screen.queryByText(/null/i)).not.toBeInTheDocument();
  });

  it('falls back to a neutral label when the snapshot is incomplete', () => {
    renderComment(buildComment({ author_type: 'internal', actor_reference_id: 'ref-1', actor_display_name: '  ', actor_organization_name: null }));
    expect(screen.getByText('Unknown User')).toBeInTheDocument();
    expect(screen.queryByText(/null/i)).not.toBeInTheDocument();
  });

  it('does not let the MSP edit a foreign-authored comment, even if a user id collides', () => {
    renderComment(buildComment({ author_type: 'internal', user_id: 'user-1', ...FOREIGN }), {
      'user-1': { user_id: 'user-1', first_name: 'Local', last_name: 'Person', user_type: 'internal', avatarUrl: null },
    });
    expect(screen.queryByLabelText('Edit comment')).not.toBeInTheDocument();
    expect(screen.queryByText('Local Person')).not.toBeInTheDocument();
  });

  it('renders a local comment exactly as before when no attribution is present', () => {
    renderComment(buildComment({ author_type: 'internal', user_id: 'user-1' }), {
      'user-1': { user_id: 'user-1', first_name: 'Local', last_name: 'Person', user_type: 'internal', avatarUrl: null },
    });
    expect(screen.getByText('Local Person')).toBeInTheDocument();
    expect(screen.getByLabelText('Edit comment')).toBeInTheDocument();
  });

  it.each([
    ['Entry', 'default'],
    ['Grid', 'compact'],
  ] as const)('updates an initially unknown author immediately in the %s comment presentation', (_layout, variant) => {
    const comment = buildComment({ author_type: 'internal', user_id: 'posting-user' });
    const view = renderComment(comment, {}, variant);
    expect(screen.getByText('Unknown User')).toBeInTheDocument();

    view.rerender(commentElement(comment, {
      'posting-user': { user_id: 'posting-user', first_name: 'Ada', last_name: 'Technician', user_type: 'internal', avatarUrl: null },
    }, variant));

    expect(screen.getByText('Ada Technician')).toBeInTheDocument();
    expect(screen.queryByText('Unknown User')).not.toBeInTheDocument();
  });
});
