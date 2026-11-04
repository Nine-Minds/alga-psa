// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TicketConversation from './TicketConversation';

type TicketConversationProps = React.ComponentProps<typeof TicketConversation>;

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
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

vi.mock('./CommentItem', () => ({
  default: ({ conversation }: any) => (
    <div data-testid="comment-item">{conversation.comment_id}</div>
  ),
}));

const localStorageState = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => localStorageState.get(key) ?? null,
  setItem: (key: string, value: string) => {
    localStorageState.set(key, value);
  },
  removeItem: (key: string) => {
    localStorageState.delete(key);
  },
  clear: () => {
    localStorageState.clear();
  },
};


const clientUser = { user_id: 'client-1', first_name: 'Cam', last_name: 'Client', user_type: 'client', avatarUrl: null };

function renderWith(conversations: any[]) {
  return render(
    <TicketConversation
      id="ticket-conversation"
      ticket={{ ticket_id: 'ticket-1', tenant: 'tenant-1' } as any}
      conversations={conversations}
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
}

const comment = (overrides: Record<string, unknown>) => ({
  comment_id: 'comment-1', note: 'x', is_internal: false, is_resolution: false,
  created_at: '2026-05-13T09:00:00.000Z', ...overrides,
});

describe('TicketConversation collaborator attribution', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} }, configurable: true,
    });
    Object.defineProperty(window, 'IntersectionObserver', {
      value: class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); takeRecords = vi.fn(() => []); },
      configurable: true,
    });
    vi.clearAllMocks();
  });

  it('keeps the contact-avatar lookup for an unattributed client comment', async () => {
    renderWith([comment({ user_id: 'client-1' })]);
    await waitFor(() => expect(getUserContactId).toHaveBeenCalledWith('client-1'));
    expect(screen.getAllByTestId('comment-item')).toHaveLength(1);
  });

  it('skips the contact-avatar lookup for a comment carrying foreign attribution', async () => {
    renderWith([comment({
      user_id: 'client-1', actor_reference_id: 'ref-1', actor_display_name: 'Morgan Provider', actor_organization_name: 'Partner MSP',
    })]);
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(1));
    await act(async () => { await Promise.resolve(); });
    expect(getUserContactId).not.toHaveBeenCalled();
    expect(getContactAvatarUrlAction).not.toHaveBeenCalled();
  });
});
