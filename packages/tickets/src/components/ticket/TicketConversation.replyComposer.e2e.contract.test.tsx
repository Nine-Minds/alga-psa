// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketConversation from './TicketConversation';

type TicketConversationProps = React.ComponentProps<typeof TicketConversation>;

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: () => <div data-testid="rich-text-viewer" />,
  TextEditor: () => <div data-testid="inline-reply-editor" />,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
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
    props: {
      textAlignment: 'left',
      backgroundColor: 'default',
      textColor: 'default',
    },
    content: [{ type: 'text', text: 'Ticket comment', styles: {} }],
  },
]);

const defaultProps: TicketConversationProps = {
  id: 'ticket-conversation',
  ticket: { ticket_id: 'ticket-1' } as any,
  conversations: [
    {
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
    } as any,
  ],
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
};

function StatefulTicketConversationForReplies() {
  const [conversations, setConversations] = React.useState(defaultProps.conversations);

  return (
    <TicketConversation
      {...defaultProps}
      conversations={conversations}
      onAddReplyComment={async (_content, parentCommentId, isInternal) => {
        setConversations((current) => [
          ...current,
          {
            tenant: 'tenant-1',
            comment_id: 'reply-1',
            thread_id: 'thread-1',
            parent_comment_id: parentCommentId,
            user_id: 'current-user',
            author_type: 'internal',
            note: NOTE,
            is_internal: isInternal,
            is_resolution: false,
            created_at: '2026-05-13T09:05:00.000Z',
          } as any,
        ]);
        return true;
      }}
    />
  );
}

function TicketConversationWithExistingReply() {
  return (
    <TicketConversation
      {...defaultProps}
      conversations={[
        ...defaultProps.conversations,
        {
          tenant: 'tenant-1',
          comment_id: 'existing-reply',
          thread_id: 'thread-1',
          parent_comment_id: 'comment-1',
          user_id: 'user-1',
          author_type: 'internal',
          note: NOTE,
          is_internal: false,
          is_resolution: false,
          created_at: '2026-05-13T09:05:00.000Z',
        } as any,
      ]}
    />
  );
}

function StatefulTicketConversationForDrawerReplies() {
  const [conversations, setConversations] = React.useState([
    ...defaultProps.conversations,
    {
      tenant: 'tenant-1',
      comment_id: 'existing-reply',
      thread_id: 'thread-1',
      parent_comment_id: 'comment-1',
      user_id: 'user-1',
      author_type: 'internal',
      note: NOTE,
      is_internal: false,
      is_resolution: false,
      created_at: '2026-05-13T09:05:00.000Z',
    } as any,
  ]);

  return (
    <TicketConversation
      {...defaultProps}
      conversations={conversations}
      onAddReplyComment={async (_content, parentCommentId, isInternal) => {
        setConversations((current) => [
          ...current,
          {
            tenant: 'tenant-1',
            comment_id: 'drawer-reply',
            thread_id: 'thread-1',
            parent_comment_id: parentCommentId,
            user_id: 'current-user',
            author_type: 'internal',
            note: NOTE,
            is_internal: isInternal,
            is_resolution: false,
            created_at: '2026-05-13T09:10:00.000Z',
          } as any,
        ]);
        return true;
      }}
    />
  );
}

function StatefulTicketConversationForNestedReplies() {
  const [conversations, setConversations] = React.useState([
    ...defaultProps.conversations,
    {
      tenant: 'tenant-1',
      comment_id: 'existing-reply',
      thread_id: 'thread-1',
      parent_comment_id: 'comment-1',
      user_id: 'user-1',
      author_type: 'internal',
      note: NOTE,
      is_internal: false,
      is_resolution: false,
      created_at: '2026-05-13T09:05:00.000Z',
    } as any,
  ]);

  return (
    <TicketConversation
      {...defaultProps}
      conversations={conversations}
      onAddReplyComment={async (_content, parentCommentId, isInternal) => {
        setConversations((current) => [
          ...current,
          {
            tenant: 'tenant-1',
            comment_id: 'nested-reply',
            thread_id: 'thread-1',
            parent_comment_id: parentCommentId,
            user_id: 'current-user',
            author_type: 'internal',
            note: NOTE,
            is_internal: isInternal,
            is_resolution: false,
            created_at: '2026-05-13T09:10:00.000Z',
          } as any,
        ]);
        return true;
      }}
    />
  );
}

describe('TicketConversation threaded reply e2e contract', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'IntersectionObserver', {
      value: vi.fn(() => ({
        observe: vi.fn(),
        disconnect: vi.fn(),
      })),
      configurable: true,
    });
    vi.clearAllMocks();
  });

  it('T057: hover comment, click Reply, and open the inline reply composer', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(<TicketConversation {...defaultProps} />);
    });

    await screen.findByTestId('comment-1');
    await user.hover(screen.getByTestId('comment-1'));

    const replyButton = screen.getByRole('button', { name: 'Reply to comment' });
    expect(replyButton.closest('.c-actions')).not.toBeNull();

    await user.click(replyButton);

    expect(screen.getByTestId('ticket-conversation-reply-comment-1')).toBeInTheDocument();
    expect(screen.getByTestId('inline-reply-editor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reply' })).toBeInTheDocument();
  });

  it('T058: submitting an inline reply renders an indented child with a thread bar', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(<StatefulTicketConversationForReplies />);
    });

    await user.click(screen.getByRole('button', { name: 'Reply to comment' }));
    await user.click(screen.getByRole('button', { name: 'Reply' }));

    expect(await screen.findByTestId('reply-1')).toBeInTheDocument();
    expect(screen.getByText('1 reply')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
    expect(screen.getByTestId('reply-1').closest('.thread-children')).toHaveClass('depth-1');
  });

  it('T059: collapsing a ticket thread hides children, shows drawer action, and expands back', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(<TicketConversationWithExistingReply />);
    });

    expect(screen.getByTestId('existing-reply')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Collapse' }));

    expect(screen.queryByTestId('existing-reply')).not.toBeInTheDocument();
    expect(screen.getByText('1 reply')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open in drawer' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand' }));

    expect(screen.getByTestId('existing-reply')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();
  });

  it('T060: opens the collapsed ticket thread in a drawer and closes back to inline state', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(<TicketConversationWithExistingReply />);
    });

    await user.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(screen.queryByTestId('existing-reply')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open in drawer' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByTestId('comment-1')).toBeInTheDocument();
    expect(within(dialog).getByTestId('existing-reply')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('comment-1')).toBeInTheDocument();
    expect(screen.queryByTestId('existing-reply')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument();
  });

  it('T061: replying in the drawer closes it and shows the new reply inline', async () => {
    const user = userEvent.setup();

    await act(async () => {
      render(<StatefulTicketConversationForDrawerReplies />);
    });

    await user.click(screen.getByRole('button', { name: 'Collapse' }));
    await user.click(screen.getByRole('button', { name: 'Open in drawer' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reply' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByTestId('drawer-reply')).toBeInTheDocument();
    expect(screen.getByTestId('drawer-reply').closest('.thread-children')).toHaveClass('depth-1');
  });

  it('T062: replying to a reply renders a dashed sub-thread bar', async () => {
    const user = userEvent.setup();
    const { container } = render(<StatefulTicketConversationForNestedReplies />);

    await user.click(document.getElementById('reply-comment-existing-reply-button')!);
    await user.click(screen.getByRole('button', { name: 'Reply' }));

    expect(await screen.findByTestId('nested-reply')).toBeInTheDocument();

    const subThreadBar = container.querySelector('.comment-thread-bar-subthread');
    expect(subThreadBar).not.toBeNull();
    expect(subThreadBar).toHaveClass('depth-1');
    expect(subThreadBar).toHaveTextContent('1 reply');
    expect(screen.getByTestId('nested-reply').closest('.thread-children-subthread')).not.toBeNull();
  });
});
