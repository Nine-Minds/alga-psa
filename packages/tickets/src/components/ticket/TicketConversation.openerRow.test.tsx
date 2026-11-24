/* @vitest-environment jsdom */
// T008: TicketConversation with the real CommentItem — an opener root with replies.

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TicketConversation from './TicketConversation';

type TicketConversationProps = React.ComponentProps<typeof TicketConversation>;

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useFormatters: () => ({
    locale: 'en',
    formatDate: (d: Date | string) => new Date(d).toISOString(),
  }),
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>) => {
      // Mirror i18next's t(key, options) form where options carries defaultValue.
      if (fallback && typeof fallback === 'object') {
        fallback = typeof fallback.defaultValue === 'string' ? fallback.defaultValue : undefined;
      }
      return typeof fallback === 'string' ? fallback : _key;
    },
  }),
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange?.(event.currentTarget.checked)}
      {...props}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/CustomTabs', () => ({
  default: ({ tabs, extraContent }: any) => (
    <div>
      {extraContent}
      <div>{tabs[0]?.content}</div>
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/UserAvatar', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: () => <div data-testid="rich-text-viewer" />,
  TextEditor: () => <div data-testid="text-editor" />,
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: () => ({}),
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: any) => <div>{children}</div>,
}));

const { getUserContactId, getContactAvatarUrlAction } = vi.hoisted(() => ({
  getUserContactId: vi.fn().mockResolvedValue(null),
  getContactAvatarUrlAction: vi.fn().mockResolvedValue(null),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getContactAvatarUrlAction,
  getUserContactId,
  searchUsersForMentions: vi.fn(),
}));

vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  uploadDocument: vi.fn(),
}));

vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({
    deleteDocument: vi.fn(),
  }),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  isActionPermissionError: () => false,
}));

vi.mock('../../actions/comment-actions/clipboardImageDraftActions', () => ({
  deleteDraftClipboardImages: vi.fn(),
}));


const clientUser = { user_id: 'client-1', first_name: 'Cam', last_name: 'Client', user_type: 'client', avatarUrl: null };

const NOTE = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'body', styles: {} }] }]);
const comment = (overrides: Record<string, unknown>) => ({
  comment_id: 'c', note: NOTE, is_internal: false, is_resolution: false, author_type: 'client', user_id: 'client-1',
  created_at: '2026-11-12T15:41:00.000Z', ...overrides,
});

describe('TicketConversation opener row with threaded replies', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} }, configurable: true,
    });
    Object.defineProperty(window, 'IntersectionObserver', {
      value: class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); takeRecords = vi.fn(() => []); },
      configurable: true,
    });
  });

  it('collapses only the root body; replies and the thread stay', () => {
    const conversations = [
      comment({ comment_id: 'root', thread_id: 'root', metadata: { responseSource: 'inbound_email', opensTicket: true, email: { messageId: 'm1', fromName: 'Cam Client', fromAddress: 'cam@client.example' } } }),
      comment({ comment_id: 'r1', thread_id: 'root', parent_comment_id: 'root', created_at: '2026-11-12T16:00:00.000Z', note: NOTE }),
      comment({ comment_id: 'r2', thread_id: 'root', parent_comment_id: 'root', created_at: '2026-11-12T16:05:00.000Z', note: NOTE }),
    ];
    render(
      <TicketConversation
        id="ticket-conversation"
        ticket={{ ticket_id: 'ticket-1', tenant: 'tenant-1' } as any}
        conversations={conversations as any}
        documents={[]}
        userMap={{ 'client-1': { ...clientUser } } as any}
        contactMap={{}}
        currentUser={{ id: 'user-1' } as any}
        activeTab="all-comments"
        isEditing={false}
        currentComment={null}
        editorKey={1}
        onNewCommentContentChange={vi.fn()}
        onAddNewComment={vi.fn().mockResolvedValue(true)}
        onTabChange={vi.fn()}
        onEdit={vi.fn()}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onDelete={vi.fn()}
        onContentChange={vi.fn()}
      />
    );

    expect(screen.getByText(/Opened by email from/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show original email' })).toBeInTheDocument();
    // Two replies still render as full comments (one viewer each); the root body is collapsed.
    expect(screen.getAllByTestId('rich-text-viewer')).toHaveLength(2);
    expect(document.body.textContent).toMatch(/2\s*repl/i);

    fireEvent.click(screen.getByRole('button', { name: 'Show original email' }));
    expect(screen.getAllByTestId('rich-text-viewer')).toHaveLength(3);
  });
});
