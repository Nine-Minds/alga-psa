/* @vitest-environment jsdom */

/**
 * The Text / Email view switcher on an inbound-email comment: offered only for
 * comments that came from mail, fetched on the first switch, withdrawn when the
 * archive has nothing to show — and remembered as a user preference, so the
 * next comment and the next ticket open in the chosen view.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IComment } from '@alga-psa/types';
import {
  INBOUND_EMAIL_VIEW_MODE_SETTING,
  setInboundEmailViewMode,
} from '@alga-psa/ui/lib/inboundEmailViewMode';
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

const storageState = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storageState.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storageState.set(key, value);
  },
  removeItem: (key: string) => {
    storageState.delete(key);
  },
  clear: () => {
    storageState.clear();
  },
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  storageState.clear();
  Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true });
  // The view mode is shared across every body on the page, so each case has to
  // start from the default rather than inherit the previous one's switch.
  setInboundEmailViewMode('text');
  storageState.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CommentItem original-email switcher', () => {
  it('does not offer the switcher on a comment that did not come from email', () => {
    renderComment(buildComment('comment-plain'));

    expect(screen.queryByRole('button', { name: 'Email' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the switcher in the heading row, out of the body', () => {
    renderComment(buildComment('comment-row', inboundMetadata));

    const switcher = screen.getByRole('group', { name: 'Message view' });
    const body = screen.getByTestId('stored-body');
    // Above the body it would cost every inbound message a line of its own, and
    // inside the clamped body it would eat part of the clamp.
    expect(switcher.closest('[data-automation-id="comment-row-content"]')).toBeNull();
    expect(switcher.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('themes the switcher chrome instead of taking the palette default', () => {
    renderComment(buildComment('comment-chrome', inboundMetadata));

    // A bare `border` resolves to Tailwind's gray default, which stays light
    // against the dark comment card it sits on.
    expect(screen.getByRole('group', { name: 'Message view' }).className).toContain(
      'border-[rgb(var(--color-border-200))]'
    );
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

    await user.click(screen.getByRole('button', { name: 'Email' }));

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

  it('remembers the choice for the next comment and the next ticket', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ html: '<p>Sender formatting</p>' }),
    });
    const user = userEvent.setup();
    const first = renderComment(buildComment('comment-remembered', inboundMetadata));

    await user.click(screen.getByRole('button', { name: 'Email' }));
    await waitFor(() => expect(screen.getByTitle('Original email')).toBeInTheDocument());
    expect(window.localStorage.getItem(INBOUND_EMAIL_VIEW_MODE_SETTING)).toBe('"email"');

    // A body mounted afterwards — another comment, another ticket — opens on
    // the original without being switched again.
    first.unmount();
    renderComment(buildComment('comment-later', inboundMetadata));

    await waitFor(() => expect(screen.getByTitle('Original email')).toBeInTheDocument());
    expect(screen.queryByTestId('stored-body')).toBeNull();
  });

  it('withdraws the switcher when no archived email exists', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    const user = userEvent.setup();
    renderComment(buildComment('comment-no-archive', inboundMetadata));

    await user.click(screen.getByRole('button', { name: 'Email' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Email' })).toBeNull());
    expect(screen.getByTestId('stored-body')).toBeInTheDocument();
  });
});
