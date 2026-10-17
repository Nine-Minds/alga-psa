// @vitest-environment jsdom

import React from 'react';
import { createInstance } from 'i18next';
import frenchTickets from '../../../../../server/public/locales/fr/features/tickets.json';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TicketConversation from './TicketConversation';
import { TicketDataSourceProvider } from './TicketDataSourceContext';
import { composeTicketDataSource } from '../../lib/ticketDataSource';
import { nativeTicketDataSource } from '../../lib/nativeTicketDataSource';

type TicketConversationProps = React.ComponentProps<typeof TicketConversation>;

const translation = vi.hoisted(() => ({ t: vi.fn() }));

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: translation.t }),
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
  default: ({ id, value, options, onValueChange }: any) => (
    <select data-testid={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
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

const audienceSource = composeTicketDataSource(nativeTicketDataSource, {
  conversation: {
    audiences: {
      options: [
        { id: 'requester', label: 'Requester and IT teams', internal: false },
        { id: 'shared_it', label: 'Shared IT teams', internal: true },
        { id: 'organization_private', label: 'Private to Customer A', internal: true },
      ],
      defaultId: 'shared_it',
      controlLabel: 'Audience',
      getCommentAudience: () => ({ id: 'shared_it', label: 'Shared IT teams' }),
    },
  },
});

function renderConversation(overrides: Partial<TicketConversationProps> = {}, dataSource?: typeof audienceSource) {
  const screen = <TicketConversation {...defaultProps} {...overrides} />;
  return render(dataSource ? <TicketDataSourceProvider dataSource={dataSource}>{screen}</TicketDataSourceProvider> : screen);
}

describe('TicketConversation composer with a co-managed audience control (T009)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true });
    Object.defineProperty(window, 'IntersectionObserver', {
      value: class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); takeRecords = vi.fn(() => []); },
      configurable: true,
    });
    localStorageMock.clear();
    vi.clearAllMocks();
    translation.t.mockImplementation((_key: string, fallback?: string | Record<string, unknown>) => {
      if (fallback && typeof fallback === 'object') {
        fallback = typeof fallback.defaultValue === 'string' ? fallback.defaultValue : undefined;
      }
      return typeof fallback === 'string' ? fallback : _key;
    });
  });

  it('localizes the default audience label when the source supplies no control label', async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: 'fr', fallbackLng: false, defaultNS: 'features/tickets',
      resources: { fr: { 'features/tickets': frenchTickets } },
    });
    translation.t.mockImplementation(i18n.t.bind(i18n));
    const source = composeTicketDataSource(audienceSource, {
      conversation: {
        audiences: { ...audienceSource.conversation.audiences!, controlLabel: undefined },
      },
    });
    const { container } = renderConversation({}, source);
    fireEvent.click(container.querySelector('#ticket-conversation-show-comment-editor-btn')!);

    await screen.findByTestId('ticket-conversation-audience-select');
    expect(container.querySelector('label[for="ticket-conversation-audience-select"]')?.textContent).toBe('Visible par');
  });

  it('shows the audience control (not the Internal toggle) and sends the chosen audience with the comment', async () => {
    const onAddNewComment = vi.fn().mockResolvedValue(true);
    const { container } = renderConversation({ onAddNewComment }, audienceSource);
    fireEvent.click(container.querySelector('#ticket-conversation-show-comment-editor-btn')!);

    const select = await screen.findByTestId('ticket-conversation-audience-select') as HTMLSelectElement;
    expect(select.value).toBe('shared_it');
    expect(Array.from(select.options).map(option => option.textContent)).toEqual(['Requester and IT teams', 'Shared IT teams', 'Private to Customer A']);
    expect(container.querySelector('#ticket-conversation-internal-toggle')).toBeNull();

    fireEvent.change(select, { target: { value: 'organization_private' } });
    fireEvent.click(container.querySelector('#ticket-conversation-add-comment-btn')!);
    await waitFor(() => expect(onAddNewComment).toHaveBeenCalledTimes(1));
    const args = onAddNewComment.mock.calls[0];
    // Private audiences are internal; the audience id is the trailing argument.
    expect(args[0]).toBe(true);
    expect(args[args.length - 1]).toBe('organization_private');
  });

  it('a requester-audience comment is not internal and the control resets to the default after saving', async () => {
    const onAddNewComment = vi.fn().mockResolvedValue(true);
    const { container } = renderConversation({ onAddNewComment }, audienceSource);
    fireEvent.click(container.querySelector('#ticket-conversation-show-comment-editor-btn')!);
    const select = await screen.findByTestId('ticket-conversation-audience-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'requester' } });
    fireEvent.click(container.querySelector('#ticket-conversation-add-comment-btn')!);
    await waitFor(() => expect(onAddNewComment).toHaveBeenCalledTimes(1));
    expect(onAddNewComment.mock.calls[0][0]).toBe(false);
    expect(onAddNewComment.mock.calls[0].at(-1)).toBe('requester');
  });

  it('without an audience-aware source the native Internal toggle remains and no audience argument is sent', async () => {
    const onAddNewComment = vi.fn().mockResolvedValue(true);
    const { container } = renderConversation({ onAddNewComment });
    fireEvent.click(container.querySelector('#ticket-conversation-show-comment-editor-btn')!);
    expect(screen.queryByTestId('ticket-conversation-audience-select')).toBeNull();
    expect(container.querySelector('#ticket-conversation-internal-toggle')).not.toBeNull();
    fireEvent.click(container.querySelector('#ticket-conversation-add-comment-btn')!);
    await waitFor(() => expect(onAddNewComment).toHaveBeenCalledTimes(1));
    expect(onAddNewComment.mock.calls[0]).toHaveLength(6);
  });
});
