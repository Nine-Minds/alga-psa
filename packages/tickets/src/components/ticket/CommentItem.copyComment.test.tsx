/* @vitest-environment jsdom */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const RICH_NOTE = JSON.stringify([
  {
    type: 'paragraph',
    props: {
      textAlignment: 'left',
      backgroundColor: 'default',
      textColor: 'default',
    },
    content: [
      { type: 'text', text: 'Restart ', styles: {} },
      { type: 'text', text: 'now', styles: { bold: true } },
    ],
  },
]);

function buildComment(overrides: Partial<IComment>): IComment {
  return {
    tenant: 'tenant-1',
    author_type: 'internal',
    comment_id: 'comment-1',
    user_id: 'user-1',
    note: NOTE,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const userMap = {
  'user-1': {
    user_id: 'user-1',
    first_name: 'A',
    last_name: 'User',
    email: 'a@example.com',
    user_type: 'internal',
    avatarUrl: null,
  },
};

function stubClipboard(clipboard: Record<string, unknown>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: clipboard,
    configurable: true,
    writable: true,
  });
}

class FakeClipboardItem {
  constructor(public readonly data: Record<string, Blob>) {}
}

// jsdom's Blob has no text(); read the flavor through FileReader instead.
function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

function stubClipboardItem() {
  (globalThis as Record<string, unknown>).ClipboardItem = FakeClipboardItem;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).ClipboardItem;
});

function renderComment(overrides: Partial<IComment> = {}, props: Record<string, unknown> = {}) {
  return render(
    <CommentItem
      conversation={buildComment(overrides)}
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
      {...props}
    />
  );
}

describe('CommentItem copy control', () => {
  it("offers copy on another user's comment even without reply or edit rights", () => {
    renderComment();

    const copyButton = screen.getByRole('button', { name: 'Copy comment text' });
    expect(copyButton.closest('.c-actions')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit comment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reply to comment' })).not.toBeInTheDocument();
  });

  it('copies the comment plain text and confirms the copied state', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });

    renderComment();

    await user.click(screen.getByRole('button', { name: 'Copy comment text' }));

    expect(writeText).toHaveBeenCalledWith('Hi');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Copy comment text' })).not.toBeInTheDocument();
  });

  it('copies rich text alongside plain text when the browser supports it', async () => {
    const user = userEvent.setup();
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ write, writeText });
    stubClipboardItem();

    renderComment({ note: RICH_NOTE });

    await user.click(screen.getByRole('button', { name: 'Copy comment text' }));

    expect(writeText).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);

    const [items] = write.mock.calls[0] as [FakeClipboardItem[]];
    expect(items).toHaveLength(1);
    expect(await readBlobText(items[0].data['text/html'])).toBe('<p>Restart <strong>now</strong></p>');
    expect(await readBlobText(items[0].data['text/plain'])).toBe('Restart now');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    });
  });

  it('falls back to plain text when the rich clipboard write is refused', async () => {
    const user = userEvent.setup();
    const write = vi.fn().mockRejectedValue(new Error('unsupported flavor'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ write, writeText });
    stubClipboardItem();

    renderComment({ note: RICH_NOTE });

    await user.click(screen.getByRole('button', { name: 'Copy comment text' }));

    expect(writeText).toHaveBeenCalledWith('Restart now');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    });
  });

  it('hides copy on a soft-deleted comment', () => {
    renderComment({ deleted_at: new Date().toISOString(), note: '[deleted]' });

    expect(screen.queryByRole('button', { name: 'Copy comment text' })).not.toBeInTheDocument();
  });

  it('surfaces a failure state when the clipboard rejects', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    stubClipboard({ writeText });

    renderComment();

    await user.click(screen.getByRole('button', { name: 'Copy comment text' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
    });
  });
});
