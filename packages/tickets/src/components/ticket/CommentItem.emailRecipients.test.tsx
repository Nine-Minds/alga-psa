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
  'conversation.cc': 'Cc',
  'conversation.bcc': 'Bcc',
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

describe('CommentItem one-off Cc/Bcc lines', () => {
  it('T059: renders Cc and Bcc with names when known and raw addresses otherwise', () => {
    renderComment(
      buildComment({
        user_id: AGENT_USER_ID,
        author_type: 'internal',
        metadata: {
          email_recipients: {
            cc: [{ email: 'jane@client.com', name: 'Jane Doe' }, { email: 'vendor@acme.com' }],
            bcc: [{ email: 'boss@msp.test', name: 'The Boss' }],
          },
        },
      } as Partial<IComment>)
    );

    const lines = document.querySelector('[data-automation-id="comment-1-email-recipients"]');
    expect(lines).not.toBeNull();
    expect(lines!.textContent).toContain('Cc: Jane Doe, vendor@acme.com');
    expect(lines!.textContent).toContain('Bcc: The Boss');
  });

  it('T061: a comment whose bcc was stripped shows a Cc line and no Bcc line', () => {
    renderComment(
      buildComment({
        user_id: AGENT_USER_ID,
        author_type: 'internal',
        metadata: {
          email_recipients: { cc: [{ email: 'jane@client.com', name: 'Jane Doe' }], bcc: [] },
        },
      } as Partial<IComment>)
    );

    const lines = document.querySelector('[data-automation-id="comment-1-email-recipients"]')!;
    expect(lines.textContent).toContain('Cc: Jane Doe');
    expect(lines.textContent).not.toContain('Bcc');
  });

  it('T059: a comment without email_recipients renders no recipient lines', () => {
    renderComment(buildComment({ user_id: AGENT_USER_ID, author_type: 'internal' }));
    expect(document.querySelector('[data-automation-id="comment-1-email-recipients"]')).toBeNull();
  });
});
