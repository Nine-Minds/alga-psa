/* @vitest-environment jsdom */

/**
 * The "Original email" toggle on an inbound-email comment: offered only for
 * comments that came from mail, fetched on the first switch, and withdrawn when
 * the archive has nothing to show.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IComment } from '@alga-psa/types';
import CommentItem from './CommentItem';

vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: () => <div data-testid="stored-body" />,
  TextEditor: () => <div data-testid="text-editor" />,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  searchUsersForMentions: vi.fn(),
}));

vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({
  DateTimePicker: () => <input data-testid="datetimepicker" />,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({
    locale: 'en',
    formatDate: (date: Date | string) => String(date),
    formatNumber: (value: number) => String(value),
    formatCurrency: (value: number) => String(value),
    formatRelativeTime: (date: Date | string) => String(date),
  }),
  useTranslation: () => ({
    t: (_key: string, defaultValue: string) => defaultValue,
  }),
}));

const TICKET_ID = 'ticket-1';
const NOTE = JSON.stringify([
  { type: 'paragraph', content: [{ type: 'text', text: 'Converted body', styles: {} }] },
]);

function buildComment(commentId: string, metadata?: IComment['metadata']): IComment {
  return {
    tenant: 'tenant-1',
    author_type: 'contact',
    comment_id: commentId,
    contact_id: 'contact-1',
    note: NOTE,
    created_at: new Date('2026-10-20T10:00:00.000Z').toISOString(),
    metadata,
  } as IComment;
}

function renderComment(comment: IComment) {
  return render(
    <CommentItem
      conversation={comment}
      currentUserId="user-1"
      isEditing={false}
      currentComment={null}
      ticketId={TICKET_ID}
      userMap={{}}
      contactMap={{}}
      onContentChange={vi.fn()}
      onSave={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

const inboundMetadata = {
  responseSource: 'inbound_email',
  email: { messageId: 'abc@example.test', providerId: 'provider-1' },
} as unknown as IComment['metadata'];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CommentItem original-email toggle', () => {
  it('does not offer the toggle on a comment that did not come from email', () => {
    renderComment(buildComment('comment-plain'));

    expect(screen.queryByRole('button', { name: 'Original email' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches and renders the original email only once the reader switches to it', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ html: '<p>Sender formatting</p>' }),
    });
    const user = userEvent.setup();
    renderComment(buildComment('comment-inbound', inboundMetadata));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('stored-body')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Original email' }));

    await waitFor(() => expect(screen.getByTitle('Original email')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tickets/${TICKET_ID}/email-html?commentId=comment-inbound`,
      expect.anything()
    );
    expect(screen.getByTitle('Original email').getAttribute('srcdoc')).toContain('<p>Sender formatting</p>');
    expect(screen.queryByTestId('stored-body')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Text' }));
    expect(screen.getByTestId('stored-body')).toBeInTheDocument();
  });

  it('withdraws the toggle when no archived email exists', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const user = userEvent.setup();
    renderComment(buildComment('comment-no-archive', inboundMetadata));

    await user.click(screen.getByRole('button', { name: 'Original email' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Original email' })).toBeNull()
    );
    expect(screen.getByTestId('stored-body')).toBeInTheDocument();
  });
});
