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
    t: (key: string, fallback?: string) => {
      const translations: Record<string, string> = {
        'conversation.systemAuthor': 'System',
        'conversation.bundledUpdate': 'Bundled update',
        'conversation.unknownUser': 'Unknown User',
      };
      return translations[key] ?? fallback ?? key;
    },
  }),
}));

const NOTE = JSON.stringify([
  {
    type: 'paragraph',
    props: { textAlignment: 'left', backgroundColor: 'default', textColor: 'default' },
    content: [{ type: 'text', text: 'Huntress incident note', styles: {} }],
  },
]);

const huntressComment: IComment = {
  tenant: 'tenant-1',
  author_type: 'unknown',
  comment_id: 'comment-1',
  user_id: null,
  contact_id: null,
  is_system_generated: true,
  note: NOTE,
  created_at: new Date().toISOString(),
} as IComment;

function renderComment(comment: IComment, variant: 'default' | 'compact' = 'default') {
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
      variant={variant}
    />
  );
}

describe('CommentItem system-author rendering', () => {
  it('renders the system glyph and the System name for a non-mirror system comment', () => {
    const { container } = renderComment(huntressComment);

    const avatar = container.querySelector('[data-automation-id="comment-1-avatar"]');
    expect(avatar).toBeTruthy();
    expect(avatar?.getAttribute('data-avatar-kind')).toBe('system');
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.queryByText('UU')).not.toBeInTheDocument();
    expect(screen.queryByText('Bundled update')).not.toBeInTheDocument();
    expect(container.querySelector('[data-automation-id="comment-1-bundled-update-badge"]')).toBeNull();
  });

  it('uses the sm avatar size in the compact timeline variant', () => {
    const { container } = renderComment(huntressComment, 'compact');
    const avatar = container.querySelector('[data-automation-id="comment-1-avatar"]');
    expect(avatar?.className).toContain('h-8');
    expect(avatar?.className).toContain('rounded-full');
  });
});
