// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const capability = vi.hoisted(() => ({ enabled: false }));
vi.mock('@alga-psa/ui/hooks/useCapability', () => ({
  useCapability: () => ({ enabled: capability.enabled, admitted: capability.enabled, resolved: true }),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, value, onValueChange, options, placeholder }: any) => (
    <select id={id} value={value ?? ''} onChange={(event) => onValueChange(event.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
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

describe('TicketConversation audience composer', () => {
  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true });
    Object.defineProperty(window, 'IntersectionObserver', {
      value: class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
        takeRecords = vi.fn(() => []);
      },
      configurable: true,
    });
    capability.enabled = true;
    vi.clearAllMocks();
  });

  const open = (container: HTMLElement) => fireEvent.click(container.querySelector('#ticket-conversation-show-comment-editor-btn')!);
  const submit = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('#ticket-conversation-add-comment-btn')!;
  const audienceSelect = (container: HTMLElement) => container.querySelector<HTMLSelectElement>('#ticket-conversation-audience-select')!;

  it('fails closed: no audience chosen disables submit and never calls the action', () => {
    const onAddNewComment = vi.fn().mockResolvedValue(true);
    const { container } = renderConversation({ onAddNewComment });
    open(container);
    expect(container.querySelector('#ticket-conversation-internal-toggle')).toBeNull();
    expect(submit(container)).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Choose who can see this comment before posting it.');
    fireEvent.click(submit(container));
    expect(onAddNewComment).not.toHaveBeenCalled();
  });

  it('offers only requester and organization private, and sends the chosen audience with matching visibility', async () => {
    const onAddNewComment = vi.fn().mockResolvedValue(true);
    const { container } = renderConversation({ onAddNewComment });
    open(container);
    expect(Array.from(audienceSelect(container).options).map((o) => o.value)).toEqual(['', 'requester', 'organization_private']);

    fireEvent.change(audienceSelect(container), { target: { value: 'organization_private' } });
    expect(submit(container)).not.toBeDisabled();
    fireEvent.click(submit(container));
    await waitFor(() => expect(onAddNewComment).toHaveBeenCalledTimes(1));
    const args = onAddNewComment.mock.calls[0];
    expect(args[0]).toBe(true);
    expect(args[6]).toBe('organization_private');
  });

  it('keeps the draft and audience when the publish is not confirmed', async () => {
    const onAddNewComment = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { container } = renderConversation({ onAddNewComment });
    open(container);
    fireEvent.change(audienceSelect(container), { target: { value: 'requester' } });
    fireEvent.click(submit(container));
    await waitFor(() => expect(onAddNewComment).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(submit(container)).not.toBeDisabled());
    // Editor stays open and the audience choice survives for the retry.
    expect(audienceSelect(container).value).toBe('requester');
    fireEvent.click(submit(container));
    await waitFor(() => expect(onAddNewComment).toHaveBeenCalledTimes(2));
    expect(onAddNewComment.mock.calls[1][6]).toBe('requester');
  });

  it('renders the legacy Internal toggle and sends no audience when the capability is off', async () => {
    capability.enabled = false;
    const onAddNewComment = vi.fn().mockResolvedValue(true);
    const { container } = renderConversation({ onAddNewComment });
    open(container);
    expect(container.querySelector('#ticket-conversation-internal-toggle')).not.toBeNull();
    expect(audienceSelect(container)).toBeNull();
    fireEvent.click(submit(container));
    await waitFor(() => expect(onAddNewComment).toHaveBeenCalledTimes(1));
    expect(onAddNewComment.mock.calls[0]).toHaveLength(6);
  });
});
