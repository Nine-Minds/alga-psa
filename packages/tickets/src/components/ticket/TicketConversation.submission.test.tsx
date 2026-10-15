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

describe('TicketConversation comment submission', () => {
  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
    Object.defineProperty(window, 'IntersectionObserver', {
      value: class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
        takeRecords = vi.fn(() => []);
        constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
      },
      configurable: true,
    });
    vi.clearAllMocks();
  });

  it('submits once and stays pending until the save settles when the host tracks no submission state', async () => {
    let settle!: (success: boolean) => void;
    const onAddNewComment = vi.fn(() => new Promise<boolean>((resolve) => { settle = resolve; }));
    // Client portal host: hides the internal tab and passes no isSubmitting.
    const { container } = renderConversation({ hideInternalTab: true, onAddNewComment });

    fireEvent.click(container.querySelector('#ticket-conversation-show-comment-editor-btn')!);
    const submit = () => container.querySelector<HTMLButtonElement>('#ticket-conversation-add-comment-btn');
    fireEvent.click(submit()!);
    fireEvent.click(submit()!);

    expect(onAddNewComment).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(submit()).toBeDisabled());
    expect(container.querySelector('#ticket-conversation-cancel-comment-btn')).toBeDisabled();

    await act(async () => { settle(true); });

    await waitFor(() => expect(submit()).toBeNull());
    expect(onAddNewComment).toHaveBeenCalledTimes(1);
  });

  it('re-enables the composer for a retry after a failed save', async () => {
    const onAddNewComment = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { container } = renderConversation({ hideInternalTab: true, onAddNewComment });

    fireEvent.click(container.querySelector('#ticket-conversation-show-comment-editor-btn')!);
    const submit = () => container.querySelector<HTMLButtonElement>('#ticket-conversation-add-comment-btn');
    fireEvent.click(submit()!);

    await waitFor(() => expect(submit()).not.toBeDisabled());
    fireEvent.click(submit()!);

    await waitFor(() => expect(submit()).toBeNull());
    expect(onAddNewComment).toHaveBeenCalledTimes(2);
  });
});
