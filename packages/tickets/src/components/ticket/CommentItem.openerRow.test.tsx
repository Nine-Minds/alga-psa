/* @vitest-environment jsdom */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IComment } from '@alga-psa/types';
import CommentItem from './CommentItem';

vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: () => <div data-testid="rich-text-viewer">FULL BODY</div>,
  TextEditor: () => <div data-testid="text-editor" />,
}));
vi.mock('@alga-psa/ui/components/ReactionDisplay', () => ({ ReactionDisplay: () => <div /> }));
vi.mock('@alga-psa/user-composition/actions', () => ({ searchUsersForMentions: vi.fn() }));

const strings: Record<string, string> = {
  'conversation.opener.openedBy': 'Opened by email from {{sender}}',
  'conversation.opener.attachments_one': '{{count}} attachment',
  'conversation.opener.attachments_other': '{{count}} attachments',
  'conversation.opener.show': 'Show original email',
  'conversation.opener.hide': 'Hide original email',
  'conversation.unknownUser': 'Unknown User',
};
function interpolate(template: string, vars: Record<string, unknown>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k]));
}
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({
    locale: 'en',
    formatDate: (date: Date | string, options?: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en', { timeZone: 'UTC', ...options }).format(typeof date === 'string' ? new Date(date) : date),
  }),
  useTranslation: () => ({
    t: (key: string, arg?: unknown) => {
      if (typeof arg === 'string') return strings[key] ?? arg;
      const opts = (arg ?? {}) as Record<string, unknown>;
      const pluralKey = typeof opts.count === 'number' ? `${key}_${opts.count === 1 ? 'one' : 'other'}` : key;
      const template = strings[pluralKey] ?? strings[key] ?? (opts.defaultValue as string | undefined) ?? key;
      return interpolate(template, opts);
    },
  }),
}));

const NOTE = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Hi', styles: {} }] }]);

function comment(overrides: Partial<IComment>): IComment {
  return {
    tenant: 't', author_type: 'unknown', comment_id: 'c1', user_id: null, note: NOTE,
    created_at: '2026-11-12T15:41:00.000Z', ...overrides,
  } as IComment;
}

function renderItem(conversation: IComment, props: Record<string, unknown> = {}, contactMap: any = {}) {
  return render(
    <CommentItem
      conversation={conversation}
      currentUserId="u1"
      isEditing={false}
      currentComment={null}
      ticketId="ticket-1"
      userMap={{}}
      contactMap={contactMap}
      onContentChange={() => {}}
      onSave={() => {}}
      onClose={() => {}}
      {...props}
    />
  );
}

const opener = {
  author_type: 'contact' as const,
  contact_id: 'contact-1',
  metadata: {
    responseSource: 'inbound_email' as const,
    opensTicket: true,
    attachmentCount: 2,
    email: { messageId: 'm1', fromName: 'Jane Doe', fromAddress: 'jane@example.com' },
  },
};

describe('CommentItem opener row', () => {
  it('renders the compact row, expands to the full comment and collapses again', () => {
    renderItem(comment(opener), {}, { 'contact-1': { contact_id: 'contact-1', full_name: 'Jane Doe', email: 'jane@example.com' } });

    expect(screen.getByText(/Opened by email from Jane Doe/)).toBeInTheDocument();
    expect(screen.getByText(/jane@example\.com/)).toBeInTheDocument();
    expect(screen.getByText(/Nov 12, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/2 attachments/)).toBeInTheDocument();
    expect(screen.queryByTestId('rich-text-viewer')).not.toBeInTheDocument();

    const show = screen.getByRole('button', { name: 'Show original email' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(show);

    expect(screen.getByTestId('rich-text-viewer')).toBeInTheDocument();
    const hide = screen.getByRole('button', { name: 'Hide original email' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(hide);

    expect(screen.queryByTestId('rich-text-viewer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show original email' })).toBeInTheDocument();
  });

  it('renders non-opener comments unchanged', () => {
    renderItem(comment({ metadata: { responseSource: 'inbound_email' as const, email: { messageId: 'm2' } } }));
    expect(screen.getByTestId('rich-text-viewer')).toBeInTheDocument();
    expect(screen.queryByText(/Opened by email/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /original email/i })).not.toBeInTheDocument();
  });

  it('names the inbound sender identity for an unmatched sender, in the compact variant', () => {
    renderItem(
      comment({ metadata: { ...opener.metadata, email: { messageId: 'm1', fromName: 'Pat Stranger', fromAddress: 'pat@elsewhere.example' } } }),
      { variant: 'compact' }
    );
    expect(screen.getByText(/Opened by email from Pat Stranger/)).toBeInTheDocument();
    expect(screen.getByText(/pat@elsewhere\.example/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show original email' })).toBeInTheDocument();
  });

  it('omits the address when it equals the sender name', () => {
    renderItem(comment({ metadata: { ...opener.metadata, attachmentCount: undefined, email: { messageId: 'm1', fromAddress: 'solo@example.com' } } }));
    expect(screen.getByText(/Opened by email from solo@example\.com/)).toBeInTheDocument();
    expect(screen.queryByText(/‹/)).not.toBeInTheDocument();
    expect(screen.queryByText(/attachment/)).not.toBeInTheDocument();
  });

  it('shows no address for redacted (portal) metadata', () => {
    // redactCommentForClient strips metadata.email but keeps the top-level marker.
    renderItem(
      comment({ author_type: 'contact', contact_id: 'contact-1', metadata: { responseSource: 'inbound_email' as const, opensTicket: true, attachmentCount: 1 } }),
      {},
      { 'contact-1': { contact_id: 'contact-1', full_name: 'Jane Doe', email: 'jane@example.com' } }
    );
    expect(screen.getByText(/Opened by email from Jane Doe/)).toBeInTheDocument();
    expect(screen.queryByText(/jane@example\.com/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 attachment/)).toBeInTheDocument();
  });
});
