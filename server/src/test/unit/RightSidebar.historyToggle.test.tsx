/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RightSidebarContent from '@ee/components/layout/RightSidebarContent';
import { listCurrentUserChatsAction } from '@ee/lib/chat-actions/chatActions';

vi.mock('@ee/components/chat/Chat', () => ({
  Chat: () => <div data-testid="chat-body" />,
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

  it('exposes a visible hide button that closes the sidebar', () => {
    const setIsOpen = vi.fn();

    render(
      <RightSidebarContent
        isOpen
        setIsOpen={setIsOpen}
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

    expect(setIsOpen).toHaveBeenCalledWith(false);
  });
});
