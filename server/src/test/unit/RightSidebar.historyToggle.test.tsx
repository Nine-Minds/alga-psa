/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RightSidebarContent from '@ee/components/layout/RightSidebarContent';
import { getChatMessagesAction, listCurrentUserChatsAction } from '@ee/lib/chat-actions/chatActions';

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
  ConfirmationDialog: () => null,
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
  DropdownMenuItem: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => (
    <button type="button" onClick={onSelect}>
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
}));

describe('RightSidebarContent history toggle', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps history hidden by default and resets it after close/reopen', async () => {
    vi.mocked(listCurrentUserChatsAction).mockResolvedValue([
      {
        id: 'chat-1',
        title_text: 'Saved chat',
        title_is_locked: false,
        created_at: '2026-03-15T10:00:00.000Z',
        updated_at: '2026-03-15T10:05:00.000Z',
        preview_text: 'Preview text',
      },
    ]);

    const props = {
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

    const { rerender } = render(<RightSidebarContent {...props} />);

    expect(screen.queryByText('Recent Chats')).not.toBeInTheDocument();
    expect(listCurrentUserChatsAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Show chat history' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show chat history' }));

    await waitFor(() => {
      expect(listCurrentUserChatsAction).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText('Recent Chats')).toBeInTheDocument();
    expect(await screen.findByText('Saved chat')).toBeInTheDocument();

    rerender(<RightSidebarContent {...props} isOpen={false} />);

    await waitFor(() => {
      expect(screen.queryByText('Recent Chats')).not.toBeInTheDocument();
    });

    rerender(<RightSidebarContent {...props} isOpen />);

    expect(screen.queryByText('Recent Chats')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show chat history' })).toBeInTheDocument();
    expect(listCurrentUserChatsAction).toHaveBeenCalledTimes(1);
  });

  it('does not repeatedly reload history when the active chat id stays the same', async () => {
    vi.mocked(getChatMessagesAction).mockResolvedValue([]);
    vi.mocked(listCurrentUserChatsAction).mockResolvedValue([
      {
        id: 'chat-1',
        title_text: 'Saved chat',
        title_is_locked: false,
        created_at: '2026-03-15T10:00:00.000Z',
        updated_at: '2026-03-15T10:05:00.000Z',
        preview_text: 'Preview text',
      },
    ]);

    const props = {
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
      handoffChatId: 'chat-1',
      handoffNonce: 1,
    };

    const { rerender } = render(<RightSidebarContent {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Show chat history' }));

    await waitFor(() => {
      expect(listCurrentUserChatsAction).toHaveBeenCalledTimes(1);
    });

    rerender(<RightSidebarContent {...props} />);

    await waitFor(() => {
      expect(listCurrentUserChatsAction).toHaveBeenCalledTimes(1);
    });
  });

  it('shows a chat skeleton while loading a persisted chat from history', async () => {
    let resolveMessages: ((value: any[]) => void) | undefined;
    vi.mocked(getChatMessagesAction).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMessages = resolve;
        })
    );
    vi.mocked(listCurrentUserChatsAction).mockResolvedValue([
      {
        id: 'chat-1',
        title_text: 'Saved chat',
        title_is_locked: false,
        created_at: '2026-03-15T10:00:00.000Z',
        updated_at: '2026-03-15T10:05:00.000Z',
        preview_text: 'Preview text',
      },
    ]);

    render(
      <RightSidebarContent
        isOpen
        setIsOpen={vi.fn()}
        clientUrl="https://example.invalid"
        accountId="account-1"
        messages={[]}
        userRole="admin"
        userId="user-1"
        selectedAccount="account-1"
        handleSelectAccount={vi.fn()}
        auth_token="token"
        setChatTitle={vi.fn()}
        isTitleLocked={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show chat history' }));
    expect(await screen.findByText('Saved chat')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /Saved chat/ })[0]);

    expect(await screen.findByTestId('chat-loading-skeleton')).toBeInTheDocument();

    resolveMessages?.([]);

    await waitFor(() => {
      expect(screen.queryByTestId('chat-loading-skeleton')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('chat-body')).toBeInTheDocument();
  });

  it('exposes a visible hide button that delegates sidebar closing', () => {
    const setIsOpen = vi.fn();
    const onRequestClose = vi.fn();

    render(
      <RightSidebarContent
        isOpen
        setIsOpen={setIsOpen}
        onRequestClose={onRequestClose}
        clientUrl="https://example.invalid"
        accountId="account-1"
        messages={[]}
        userRole="admin"
        userId="user-1"
        selectedAccount="account-1"
        handleSelectAccount={vi.fn()}
        auth_token="token"
        setChatTitle={vi.fn()}
        isTitleLocked={false}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hide chat sidebar' }));

    expect(onRequestClose).toHaveBeenCalledTimes(1);
    expect(setIsOpen).not.toHaveBeenCalledWith(false);
  });
});
