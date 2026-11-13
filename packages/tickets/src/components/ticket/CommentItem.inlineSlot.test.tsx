/* @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    t: (_key: string, defaultValue: string) => defaultValue,
  }),
}));

const NOTE = JSON.stringify([
  { type: 'paragraph', props: {}, content: [{ type: 'text', text: 'Hi', styles: {} }] },
]);

const userMap = {
  'user-1': { user_id: 'user-1', first_name: 'A', last_name: 'User', email: 'a@example.com', user_type: 'internal', avatarUrl: null },
};

function renderComment(props: Record<string, unknown> = {}) {
  const comment: IComment = {
    tenant: 'tenant-1', author_type: 'internal', comment_id: 'comment-1', user_id: 'user-1', note: NOTE,
    created_at: new Date().toISOString(),
  };
  return render(
    <CommentItem
      conversation={comment}
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
      onToggleReaction={() => {}}
      reactions={[]}
      {...props}
    />
  );
}

describe('CommentItem inline slot', () => {
  it('renders the same DOM with no slot as with a null or undefined slot', () => {
    const none = renderComment().container.innerHTML;
    cleanup();
    const nul = renderComment({ inlineSlot: null }).container.innerHTML;
    cleanup();
    const undef = renderComment({ inlineSlot: undefined }).container.innerHTML;
    expect(nul).toBe(none);
    expect(undef).toBe(none);
  });

  it('renders slot content after the body and before the reactions, with no wrapper of its own', () => {
    const { container } = renderComment({ inlineSlot: <span data-testid="inline-slot">files</span> });
    const slot = screen.getByTestId('inline-slot');
    const body = screen.getByTestId('rich-text-viewer');
    const reactions = screen.getByTestId('reactions');
    expect(body.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.compareDocumentPosition(reactions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.parentElement).toBe(reactions.parentElement);
    expect(container.querySelectorAll('[data-testid="inline-slot"]')).toHaveLength(1);
  });
});
