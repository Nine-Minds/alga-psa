// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import TicketConversation from './TicketConversation';
import { TICKET_CONVERSATION_ORDER_STORAGE_KEY } from './ticketConversationOrderPreference';

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

vi.mock('@alga-psa/user-composition/actions', () => ({
  getContactAvatarUrlAction: vi.fn(),
  getUserContactId: vi.fn(),
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

const defaultProps: TicketConversationProps = {
  id: 'ticket-conversation',
  ticket: { ticket_id: 'ticket-1', tenant: 'tenant-1' } as any,
  conversations: [
    {
      comment_id: 'comment-1',
      note: 'Oldest',
      is_internal: false,
      is_resolution: false,
      created_at: '2026-05-13T09:00:00.000Z',
    } as any,
    {
      comment_id: 'comment-2',
      note: 'Newest',
      is_internal: false,
      is_resolution: false,
      created_at: '2026-05-13T10:00:00.000Z',
    } as any,
  ],
  documents: [],
  userMap: {},
  contactMap: {},
  currentUser: { id: 'user-1' },
  activeTab: 'all-comments',
  isEditing: false,
  currentComment: null,
  editorKey: 1,
  onNewCommentContentChange: vi.fn(),
  onAddNewComment: vi.fn().mockResolvedValue(true),
  onTabChange: vi.fn(),
  onEdit: vi.fn(),
  onSave: vi.fn(),
  onClose: vi.fn(),
  onDelete: vi.fn(),
  onContentChange: vi.fn(),
};

function renderConversation(overrides: Partial<TicketConversationProps> = {}) {
  return render(
    <TicketConversation
      {...defaultProps}
      {...overrides}
    />
  );
}

function getRenderedCommentOrder(): string[] {
  return screen.getAllByTestId('comment-item').map((element) => element.textContent ?? '');
}

describe('TicketConversation comment order preference', () => {
  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(window, 'IntersectionObserver', {
      value: vi.fn(() => ({
        observe: vi.fn(),
        disconnect: vi.fn(),
      })),
      configurable: true,
    });
    vi.clearAllMocks();
  });

  it('falls back to defaultNewestFirst when there is no saved browser preference', () => {
    renderConversation({ defaultNewestFirst: true });

    expect(getRenderedCommentOrder()).toEqual(['comment-2', 'comment-1']);
  });

  it('uses the saved browser preference instead of defaultNewestFirst', () => {
    window.localStorage.setItem(TICKET_CONVERSATION_ORDER_STORAGE_KEY, JSON.stringify(false));

    renderConversation({ defaultNewestFirst: true });

    expect(getRenderedCommentOrder()).toEqual(['comment-1', 'comment-2']);
  });

  it('updates the saved browser preference and rendered order when toggled', () => {
    renderConversation({ defaultNewestFirst: false });

    fireEvent.click(screen.getByRole('button', { name: /oldest first/i }));

    expect(window.localStorage.getItem(TICKET_CONVERSATION_ORDER_STORAGE_KEY)).toBe('true');
    expect(getRenderedCommentOrder()).toEqual(['comment-2', 'comment-1']);
  });

  it('T056: toggles thread order by last activity while replies stay chronological', () => {
    renderConversation({
      defaultNewestFirst: false,
      conversations: [
        {
          comment_id: 'old-thread-root',
          thread_id: 'old-thread',
          parent_comment_id: null,
          note: 'Old thread root',
          is_internal: false,
          is_resolution: false,
          created_at: '2026-05-13T09:00:00.000Z',
        } as any,
        {
          comment_id: 'old-thread-reply',
          thread_id: 'old-thread',
          parent_comment_id: 'old-thread-root',
          note: 'Old thread reply',
          is_internal: false,
          is_resolution: false,
          created_at: '2026-05-13T13:00:00.000Z',
        } as any,
        {
          comment_id: 'new-thread-root',
          thread_id: 'new-thread',
          parent_comment_id: null,
          note: 'New thread root',
          is_internal: false,
          is_resolution: false,
          created_at: '2026-05-13T10:00:00.000Z',
        } as any,
      ],
    });

    expect(getRenderedCommentOrder()).toEqual([
      'new-thread-root',
      'old-thread-root',
      'old-thread-reply',
    ]);

    fireEvent.click(screen.getByRole('button', { name: /oldest first/i }));

    expect(window.localStorage.getItem(TICKET_CONVERSATION_ORDER_STORAGE_KEY)).toBe('true');
    expect(getRenderedCommentOrder()).toEqual([
      'old-thread-root',
      'old-thread-reply',
      'new-thread-root',
    ]);
  });
});
