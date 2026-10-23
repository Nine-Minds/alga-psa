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
  'conversation.bundledUpdateFrom': 'Bundled update from {{number}}',
  'conversation.systemAuthor': 'System',
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
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>) => {
      const fallback = typeof fallbackOrOptions === 'string' ? fallbackOrOptions : undefined;
      const options = typeof fallbackOrOptions === 'object' && fallbackOrOptions !== null
        ? fallbackOrOptions
        : undefined;
      const value = translations[key] ?? fallback ?? key;
      return options
        ? value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name] ?? ''))
        : value;
    },
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

function renderComment(comment: IComment) {
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
    />
  );
}

describe('CommentItem bundled-update rendering', () => {
  it('renders the bundle glyph, label name and linked chip for an authorless mirror (MSP shape)', () => {
    const { container } = renderComment(
      buildComment({
        user_id: null,
        author_type: 'unknown',
        is_system_generated: true,
        bundle_mirror_source: {
          source_comment_id: 'source-1',
          master_ticket_id: 'master-9',
          master_ticket_number: 'MSTR-9',
        },
      })
    );

    const avatar = container.querySelector('[data-automation-id="comment-1-avatar"]');
    expect(avatar).toBeTruthy();
    expect(avatar?.getAttribute('data-avatar-kind')).toBe('bundle');
    expect(screen.queryByText('UU')).not.toBeInTheDocument();
    expect(screen.getByText('Bundled update')).toBeInTheDocument();

    const chip = container.querySelector('[data-automation-id="comment-1-bundled-update-badge"]');
    expect(chip?.tagName).toBe('A');
    expect(chip?.getAttribute('href')).toBe('/msp/tickets/master-9');
    expect(chip?.textContent).toBe('Bundled update from MSTR-9');
    expect(container.querySelector('[data-automation-id="comment-1-author-email"]')).toBeNull();
  });

  it('renders the bare labelled chip with no link for the portal mirror shape', () => {
    const { container } = renderComment(
      buildComment({
        user_id: null,
        author_type: 'unknown',
        is_system_generated: true,
        bundle_mirror_source: { source_comment_id: 'source-1' },
      })
    );

    const avatar = container.querySelector('[data-automation-id="comment-1-avatar"]');
    expect(avatar?.getAttribute('data-avatar-kind')).toBe('bundle');

    const chip = container.querySelector('[data-automation-id="comment-1-bundled-update-badge"]');
    expect(chip?.tagName).toBe('SPAN');
    expect(chip?.textContent).toBe('Bundled update');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('keeps the resolved author, real avatar and chip for a mirror with an author', () => {
    const { container } = renderComment(
      buildComment({
        user_id: AGENT_USER_ID,
        author_type: 'internal',
        is_system_generated: true,
        bundle_mirror_source: {
          source_comment_id: 'source-1',
          master_ticket_id: 'master-9',
          master_ticket_number: 'MSTR-9',
        },
      })
    );

    expect(screen.getByText('Agent Sender')).toBeInTheDocument();
    expect(screen.getByText('AS')).toBeInTheDocument();
    expect(screen.getByText('agent.sender@example.com')).toBeInTheDocument();
    expect(container.querySelector('[data-avatar-kind]')).toBeNull();

    const link = screen.getByRole('link', { name: 'Bundled update from MSTR-9' });
    expect(link).toHaveAttribute('href', '/msp/tickets/master-9');
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
