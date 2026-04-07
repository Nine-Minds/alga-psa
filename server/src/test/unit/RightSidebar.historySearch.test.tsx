/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import RightSidebarContent from '@ee/components/layout/RightSidebarContent';
import {
  deleteCurrentUserChatAction,
  getChatMessagesAction,
  listCurrentUserChatsAction,
  renameCurrentUserChatAction,
  searchCurrentUserChatsAction,
} from '@ee/lib/chat-actions/chatActions';

vi.mock('@ee/components/chat/Chat', () => ({
  Chat: ({
    initialChatId,
    onChatIdChange,
    onHasMessagesChange,
    onInterruptibleStateChange,
    onRegisterCancelHandler,
  }: {
    initialChatId?: string | null;
    onChatIdChange?: (chatId: string | null) => void;
    onHasMessagesChange?: (hasMessages: boolean) => void;
    onInterruptibleStateChange?: (isInterruptible: boolean) => void;
    onRegisterCancelHandler?: (cancelHandler: (() => void) | null) => void;
  }) => {
    React.useEffect(() => {
      onChatIdChange?.(initialChatId ?? null);
    }, [initialChatId, onChatIdChange]);

    React.useEffect(() => {
      onHasMessagesChange?.(false);
    }, [onHasMessagesChange]);

    React.useEffect(() => {
      onInterruptibleStateChange?.(false);
      onRegisterCancelHandler?.(null);
    }, [onInterruptibleStateChange, onRegisterCancelHandler]);

    return <div data-testid="chat-body" />;
  },
}));

vi.mock('@radix-ui/react-collapsible', () => ({
  Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({
    id,
    isOpen,
    onClose,
    onConfirm,
  }: {
    id: string;
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
  }) =>
    isOpen ? (
      <div>
        <button type="button" onClick={onConfirm}>
          confirm-{id}
        </button>
        <button type="button" onClick={onClose}>
          cancel-{id}
        </button>
      </div>
    ) : null,
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children, isOpen }: { children: React.ReactNode; isOpen?: boolean }) =>
    isOpen ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    className,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
    className?: string;
  }) => (
    <button type="button" onClick={onSelect} className={className}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode } & Record<string, unknown>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ label, ...props }: { label?: string } & Record<string, unknown>) => (
    <label>
      <span>{label}</span>
      <input {...props} />
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/Skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => <div data-testid="skeleton-block" className={className} />,
}));

vi.mock('@ee/lib/chat-actions/chatActions', () => ({
  getChatMessagesAction: vi.fn(),
  listCurrentUserChatsAction: vi.fn(),
  renameCurrentUserChatAction: vi.fn(),
  deleteCurrentUserChatAction: vi.fn(),
  searchCurrentUserChatsAction: vi.fn(),
}));

const baseProps = {
  isOpen: true,
  setIsOpen: vi.fn(),
  clientUrl: 'https://example.invalid',
  accountId: 'account-1',
  messages: [],
  userRole: 'admin',
  userId: 'user-1',
  selectedAccount: 'account-1',
  handleSelectAccount: vi.fn(),
  auth_token: 'token',
  setChatTitle: vi.fn(),
  isTitleLocked: false,
};

const openHistory = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Show chat history' }));
  await screen.findByText('Recent Chats');
};

const runSearchDebounce = async () => {
  await new Promise((resolve) => setTimeout(resolve, 280));
};

describe('RightSidebarContent history search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getChatMessagesAction).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps recent chats for an empty query and switches to debounced search results at 2 characters', async () => {
    vi.mocked(listCurrentUserChatsAction).mockResolvedValue([
      {
        id: 'recent-chat',
        title_text: 'Recent chat',
        title_is_locked: false,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
        preview_text: 'Recent preview',
      },
    ]);
    vi.mocked(searchCurrentUserChatsAction).mockResolvedValue([
      {
        id: 'search-chat',
        title_text: 'Search chat',
        title_is_locked: false,
        created_at: '2026-03-02T00:00:00.000Z',
        updated_at: '2026-03-02T00:00:00.000Z',
        preview_text: 'Search preview',
      },
    ]);

    render(<RightSidebarContent {...baseProps} />);
    await openHistory();

    await waitFor(() => {
      expect(listCurrentUserChatsAction).toHaveBeenCalledWith(20);
    });
    expect(screen.getByText('Recent chat')).toBeInTheDocument();
    expect(screen.getByText('Recent Chats')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search chat history'), { target: { value: 'se' } });

    expect(searchCurrentUserChatsAction).not.toHaveBeenCalled();
    await runSearchDebounce();

    await waitFor(() => {
      expect(searchCurrentUserChatsAction).toHaveBeenCalledWith('se', 20);
    });
    expect(await screen.findByText('Search Results')).toBeInTheDocument();
    expect(await screen.findByText('Search chat')).toBeInTheDocument();
  });

  it('shows query-too-short helper for 1 character and restores recent chats when cleared', async () => {
    vi.mocked(listCurrentUserChatsAction).mockResolvedValue([
      {
        id: 'recent-chat',
        title_text: 'Recent chat',
        title_is_locked: false,
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
        preview_text: 'Recent preview',
      },
    ]);

    render(<RightSidebarContent {...baseProps} />);
    await openHistory();

    await waitFor(() => {
      expect(listCurrentUserChatsAction).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByLabelText('Search chat history'), { target: { value: 'x' } });

    expect(await screen.findByText('Type at least 2 characters to search saved chats.')).toBeInTheDocument();
    expect(searchCurrentUserChatsAction).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Search chat history'), { target: { value: '' } });

    await waitFor(() => {
      expect(listCurrentUserChatsAction).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText('Recent Chats')).toBeInTheDocument();
    expect(screen.getByText('Recent chat')).toBeInTheDocument();
  });

  it('renders no-results in search mode and loads persisted chat when a search result is clicked', async () => {
    vi.mocked(listCurrentUserChatsAction).mockResolvedValue([]);
    vi.mocked(searchCurrentUserChatsAction).mockImplementation(async (query) => {
      if (query === 'alpha') {
        return [];
      }
      return [
        {
          id: 'search-hit',
          title_text: 'Search hit chat',
          title_is_locked: false,
          created_at: '2026-03-02T00:00:00.000Z',
          updated_at: '2026-03-02T00:00:00.000Z',
          preview_text: 'Search preview',
        },
      ];
    });

    render(<RightSidebarContent {...baseProps} />);
    await openHistory();

    fireEvent.change(screen.getByLabelText('Search chat history'), { target: { value: 'alpha' } });
    await runSearchDebounce();
    expect(await screen.findByText('No matching chats found.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search chat history'), { target: { value: 'beta' } });
    await runSearchDebounce();

    const searchRowButtons = await screen.findAllByRole('button', { name: /Search hit chat/ });
    fireEvent.click(searchRowButtons[0]);

    await waitFor(() => {
      expect(getChatMessagesAction).toHaveBeenCalledWith('search-hit');
    });
  });

  it('reruns active search after rename/delete and remains in search mode', async () => {
    vi.mocked(listCurrentUserChatsAction).mockResolvedValue([]);
    vi.mocked(searchCurrentUserChatsAction).mockResolvedValue([
      {
        id: 'search-hit',
        title_text: 'Search hit chat',
        title_is_locked: false,
        created_at: '2026-03-02T00:00:00.000Z',
        updated_at: '2026-03-02T00:00:00.000Z',
        preview_text: 'Search preview',
      },
    ]);
    vi.mocked(renameCurrentUserChatAction).mockResolvedValue(true);
    vi.mocked(deleteCurrentUserChatAction).mockResolvedValue(true);

    render(<RightSidebarContent {...baseProps} />);
    await openHistory();

    fireEvent.change(screen.getByLabelText('Search chat history'), { target: { value: 'ops' } });
    await runSearchDebounce();

    await waitFor(() => {
      expect(searchCurrentUserChatsAction).toHaveBeenCalledWith('ops', 20);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('Chat title'), { target: { value: 'Renamed search hit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(renameCurrentUserChatAction).toHaveBeenCalledWith('search-hit', 'Renamed search hit');
    });
    await waitFor(() => {
      expect(searchCurrentUserChatsAction).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText('Search Results')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'confirm-confirm-delete-chat' }));

    await waitFor(() => {
      expect(deleteCurrentUserChatAction).toHaveBeenCalledWith('search-hit');
    });
    await waitFor(() => {
      expect(searchCurrentUserChatsAction).toHaveBeenCalledTimes(3);
    });
    expect(screen.getByText('Search Results')).toBeInTheDocument();
  });
});
