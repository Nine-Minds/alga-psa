// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketConversation from './TicketConversation';

/**
 * How the Cc/Bcc control is wired into each composer: that it only appears
 * when the host opts in (the client portal does not), that it is absent on a
 * reply to an internal comment, and that what the agent typed reaches the
 * submit callbacks the server actions sit behind.
 */
type TicketConversationProps = React.ComponentProps<typeof TicketConversation>;

vi.mock('next/dynamic', () => ({
  // The main composer's editor arrives through next/dynamic; render its footer
  // slot so the Cc/Bcc toggle that lives there is reachable.
  default: () => ({ footerActions }: any) => (
    <div data-testid="main-editor">{footerActions}</div>
  ),
}));

vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: () => <div data-testid="rich-text-viewer" />,
  TextEditor: ({ footerActions }: any) => (
    <div data-testid="inline-reply-editor">{footerActions}</div>
  ),
}));

vi.mock('../../actions/clientLookupActions', () => ({ getContactsByClient: vi.fn(async () => []) }));
vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({ getAllUsers: vi.fn(async () => []) }));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  // Components under test format dates through useFormatters; the real hook
  // reads the locale off the provider this test does not mount.
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
  default: ({ tabs, extraContent, value, onTabChange }: any) => {
    const activeTab = tabs.find((tab: any) => tab.id === value) ?? tabs[0];
    return (
      <div>
        <div>
          {tabs.map((tab: any) => (
            <button key={tab.id} type="button" onClick={() => onTabChange?.(tab.id)}>
              {tab.label}
            </button>
          ))}
          {extraContent}
        </div>
        <div>{activeTab?.content}</div>
      </div>
    );
  },
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/UserAvatar', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/ContactAvatar', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/ReactionDisplay', () => ({
  ReactionDisplay: () => null,
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ 'data-testid': id }),
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

vi.mock('../../actions/comment-actions/commentReactionActions', () => ({
  getCommentsReactionsBatch: vi.fn(() => new Promise(() => {})),
  toggleCommentReaction: vi.fn(),
}));

const NOTE = JSON.stringify([
  {
    type: 'paragraph',
    props: { textAlignment: 'left', backgroundColor: 'default', textColor: 'default' },
    content: [{ type: 'text', text: 'Ticket comment', styles: {} }],
  },
]);

const rootComment = {
  tenant: 'tenant-1',
  comment_id: 'comment-1',
  thread_id: 'thread-1',
  parent_comment_id: null,
  user_id: 'user-1',
  author_type: 'internal',
  note: NOTE,
  is_internal: false,
  is_resolution: false,
  created_at: '2026-05-13T09:00:00.000Z',
} as any;

const existingReply = {
  ...rootComment,
  comment_id: 'existing-reply',
  parent_comment_id: 'comment-1',
  created_at: '2026-05-13T09:05:00.000Z',
} as any;

function baseProps(): TicketConversationProps {
  return {
    id: 'ticket-conversation',
    ticket: { ticket_id: 'ticket-1', client_id: 'client-1' } as any,
    conversations: [rootComment],
    documents: [],
    userMap: {
      'user-1': {
        user_id: 'user-1',
        first_name: 'A',
        last_name: 'User',
        email: 'a@example.com',
        user_type: 'internal',
        avatarUrl: null,
      },
    },
    contactMap: {},
    currentUser: { id: 'current-user' },
    activeTab: 'all-comments',
    isEditing: false,
    currentComment: null,
    editorKey: 1,
    onNewCommentContentChange: vi.fn(),
    onAddNewComment: vi.fn().mockResolvedValue(true),
    onAddReplyComment: vi.fn().mockResolvedValue(true),
    onTabChange: vi.fn(),
    onEdit: vi.fn(),
    onSave: vi.fn(),
    onClose: vi.fn(),
    onDelete: vi.fn(),
    onContentChange: vi.fn(),
  } as TicketConversationProps;
}

async function renderConversation(overrides: Partial<TicketConversationProps> = {}) {
  const props = { ...baseProps(), allowEmailRecipients: true, ...overrides };
  await act(async () => {
    render(<TicketConversation {...props} />);
  });
  return props;
}

const byId = (id: string) => document.getElementById(id);
const MAIN_TOGGLE = 'ticket-conversation-ticket-comment-cc-bcc-toggle';
const MAIN_CC = 'ticket-conversation-ticket-comment-cc-input-input';
const MAIN_BCC = 'ticket-conversation-ticket-comment-bcc-input-input';
const REPLY_TOGGLE = 'ticket-conversation-reply-comment-1-ticket-comment-cc-bcc-toggle';
const REPLY_CC = 'ticket-conversation-reply-comment-1-ticket-comment-cc-input-input';
const DRAWER_TOGGLE = 'ticket-conversation-comment-thread-drawer-ticket-comment-cc-bcc-toggle';
const DRAWER_CC = 'ticket-conversation-comment-thread-drawer-ticket-comment-cc-input-input';

// The main composer starts collapsed behind its "add comment" button.
async function openMainComposer(user: ReturnType<typeof userEvent.setup>) {
  const open = byId('ticket-conversation-show-comment-editor-btn');
  if (open) await user.click(open);
}

async function typeChip(user: ReturnType<typeof userEvent.setup>, inputId: string, address: string) {
  const input = byId(inputId) as HTMLInputElement;
  await user.type(input, address);
  await user.type(input, '{Enter}');
}

describe('TicketConversation Cc/Bcc wiring', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'IntersectionObserver', {
      value: vi.fn(function IntersectionObserverStub() {
        return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
      }),
      configurable: true,
    });
    vi.clearAllMocks();
  });

  it('T070: the control is opt-in — the client portal composer and reply have none', async () => {
    const user = userEvent.setup();
    await renderConversation({ allowEmailRecipients: false });

    await openMainComposer(user);
    expect(byId(MAIN_TOGGLE)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reply to comment' }));
    expect(byId(REPLY_TOGGLE)).toBeNull();
  });

  it('T055: a new comment sends the typed Cc/Bcc and clears them afterwards', async () => {
    const user = userEvent.setup();
    const props = await renderConversation();
    await openMainComposer(user);

    await user.click(byId(MAIN_TOGGLE)!);
    await typeChip(user, MAIN_CC, 'vendor@acme.com');
    await typeChip(user, MAIN_BCC, 'boss@msp.test');

    await user.click(screen.getByRole('button', { name: 'Add Comment' }));

    expect(props.onAddNewComment).toHaveBeenCalledWith(
      false,
      false,
      null,
      undefined,
      null,
      { cc: ['vendor@acme.com'], bcc: ['boss@msp.test'] },
    );
    // The next comment starts clean: no chips carried over.
    expect(byId('ticket-conversation-ticket-comment-cc-input-chip-vendor@acme.com')).toBeNull();
  });

  it('T055: an invalid address blocks Add Comment until it is removed', async () => {
    const user = userEvent.setup();
    const props = await renderConversation();
    await openMainComposer(user);

    await user.click(byId(MAIN_TOGGLE)!);
    await typeChip(user, MAIN_CC, 'not-an-address');

    const send = screen.getByRole('button', { name: 'Add Comment' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await user.click(send);
    expect(props.onAddNewComment).not.toHaveBeenCalled();
  });

  it('T058: an inline reply forwards its own Cc to onAddReplyComment', async () => {
    const user = userEvent.setup();
    const props = await renderConversation();

    await user.click(screen.getByRole('button', { name: 'Reply to comment' }));
    await user.click(byId(REPLY_TOGGLE)!);
    await typeChip(user, REPLY_CC, 'vendor@acme.com');

    await user.click(screen.getByRole('button', { name: 'Reply' }));

    expect(props.onAddReplyComment).toHaveBeenCalledWith(
      expect.anything(),
      'comment-1',
      false,
      { cc: ['vendor@acme.com'] },
    );
  });

  it('T067: a reply to an internal comment shows no Cc/Bcc control', async () => {
    const user = userEvent.setup();
    await renderConversation({
      conversations: [{ ...rootComment, is_internal: true }],
    });

    await user.click(screen.getByRole('button', { name: 'Reply to comment' }));
    expect(screen.getByTestId('inline-reply-editor')).toBeInTheDocument();
    expect(byId(REPLY_TOGGLE)).toBeNull();
  });

  it('T066: a reply from the thread drawer forwards Cc the same way', async () => {
    const user = userEvent.setup();
    const props = await renderConversation({ conversations: [rootComment, existingReply] });

    await user.click(screen.getByRole('button', { name: 'Collapse' }));
    await user.click(screen.getByRole('button', { name: 'Show in drawer' }));

    const dialog = screen.getByRole('dialog');
    await user.click(byId(DRAWER_TOGGLE)!);
    await typeChip(user, DRAWER_CC, 'vendor@acme.com');
    await user.click(within(dialog).getByRole('button', { name: 'Reply' }));

    expect(props.onAddReplyComment).toHaveBeenCalledWith(
      expect.anything(),
      'comment-1',
      false,
      { cc: ['vendor@acme.com'] },
    );
  });
});
