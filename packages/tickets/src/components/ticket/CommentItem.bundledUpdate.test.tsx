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
  'conversation.bundledUpdate': 'Bundled update',
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
    props: { textAlignment: 'left', backgroundColor: 'default', textColor: 'default' },
    content: [{ type: 'text', text: 'Mirrored body', styles: {} }],
  },
]);

const AGENT_USER_ID = 'agent-1';
const userMap = {
  [AGENT_USER_ID]: {
    user_id: AGENT_USER_ID,
    first_name: 'Agent',
    last_name: 'Sender',
    email: 'agent.sender@example.com',
    user_type: 'internal',
    avatarUrl: null,
  },
};

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

function renderComment(
  comment: IComment,
  bundleMaster?: { ticketId: string; ticketNumber: string | null }
) {
  return render(
    <CommentItem
      conversation={comment}
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
      bundleMaster={bundleMaster}
    />
  );
}

describe('CommentItem bundled-update rendering', () => {
  it('renders the resolved author, real avatar and a Bundled update badge for mirrored comments', () => {
    const { container } = renderComment(
      buildComment({ user_id: AGENT_USER_ID, author_type: 'internal', is_system_generated: true })
    );

    expect(screen.getByText('Agent Sender')).toBeInTheDocument();
    expect(screen.getByText('AS')).toBeInTheDocument();
    expect(screen.getByText('agent.sender@example.com')).toBeInTheDocument();
    expect(
      container.querySelector('[data-automation-id="comment-1-bundled-update-badge"]')
    ).toBeTruthy();
    // No master reference supplied: the badge is not a link.
    expect(screen.queryByRole('link', { name: 'Bundled update' })).not.toBeInTheDocument();
  });

  it('links the badge to the master when bundleMaster is supplied (MSP)', () => {
    renderComment(
      buildComment({ user_id: AGENT_USER_ID, author_type: 'internal', is_system_generated: true }),
      { ticketId: 'master-9', ticketNumber: 'MSTR-9' }
    );

    const link = screen.getByRole('link', { name: 'Bundled update' });
    expect(link).toHaveAttribute('href', '/msp/tickets/master-9');
    expect(link).toHaveAttribute('title', 'MSTR-9');
  });

  it('falls back to the label as the name and placeholder avatar for an unresolvable mirrored author', () => {
    const { container } = renderComment(
      buildComment({ user_id: null, author_type: 'unknown', is_system_generated: true })
    );

    expect(screen.getByText('Bundled update')).toBeInTheDocument();
    expect(screen.getByText('UU')).toBeInTheDocument();
    // Legacy fallback keeps today's rendering: no separate badge.
    expect(
      container.querySelector('[data-automation-id="comment-1-bundled-update-badge"]')
    ).toBeNull();
    // The placeholder author has no email line.
    expect(screen.queryByText(/mailto:/)).not.toBeInTheDocument();
  });

  it('does not badge or relabel a normal, non-mirrored comment', () => {
    const { container } = renderComment(
      buildComment({ user_id: AGENT_USER_ID, author_type: 'internal', is_system_generated: false })
    );

    expect(screen.getByText('Agent Sender')).toBeInTheDocument();
    expect(screen.queryByText('Bundled update')).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-automation-id="comment-1-bundled-update-badge"]')
    ).toBeNull();
  });
});
