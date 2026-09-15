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

function renderComment(comment: IComment) {
  return render(
    <CommentItem
      conversation={comment}
      currentUserId="user-1"
      isEditing={false}
      currentComment={null}
      ticketId="t1"
      userMap={{}}
      contactMap={{}}
      onContentChange={() => {}}
      onSave={() => {}}
      onClose={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
    />
  );
}

describe('CommentItem unresolved-author avatar', () => {
  it('seeds the avatar with the inbound sender name instead of Unknown User', () => {
    renderComment(
      buildComment({
        metadata: {
          email: { fromName: 'Ada Client', fromAddress: 'ada@client.example' },
        },
      })
    );

    expect(screen.getByText('Ada Client')).toBeInTheDocument();
    expect(screen.getByText('AC')).toBeInTheDocument();
    expect(screen.queryByText('UU')).not.toBeInTheDocument();
  });

  it('falls back to the sender address when the inbound email carries no name', () => {
    renderComment(
      buildComment({
        metadata: {
          email: { fromAddress: 'ada@client.example' },
        },
      })
    );

    expect(screen.getByText('AD')).toBeInTheDocument();
  });

  it('keeps the Unknown User avatar when no identity is available', () => {
    renderComment(buildComment({}));

    expect(screen.getByText('UU')).toBeInTheDocument();
  });
});
