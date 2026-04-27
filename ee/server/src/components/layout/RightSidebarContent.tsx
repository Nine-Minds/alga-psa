'use client';

// ee/server/src/components/layout/RightSidebarContent.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Chat } from '../chat/Chat';
import * as Collapsible from '@radix-ui/react-collapsible';
import { History, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@alga-psa/ui/components/DropdownMenu';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  deleteCurrentUserChatAction,
  getChatMessagesAction,
  listCurrentUserChatsAction,
  renameCurrentUserChatAction,
  searchCurrentUserChatsAction,
  type ChatHistoryItem,
} from '../../lib/chat-actions/chatActions';

import '../chat/chat.css';

interface RightSidebarProps {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onRequestClose?: () => void;
  clientUrl: string;
  accountId: string;
  messages: any[];
  userId: string | null;
  userRole: string;
  selectedAccount: string;
  handleSelectAccount: any;
  auth_token: string;
  setChatTitle: any;
  isTitleLocked: boolean;
  handoffChatId?: string | null;
  handoffNonce?: number;
  onInterruptibleStateChange?: (isInterruptible: boolean) => void;
  onRegisterCancelHandler?: (cancelHandler: (() => void) | null) => void;
}

const HISTORY_LIMIT = 20;
const MIN_HISTORY_SEARCH_CHARS = 2;
const HISTORY_SEARCH_DEBOUNCE_MS = 250;

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

const formatHistoryTimestamp = (t: TranslateFn, value?: string | Date | null) => {
  if (!value) {
    return t('sidebar.timestamp.recently');
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return t('sidebar.timestamp.recently');
  }

  const diffMs = Date.now() - timestamp.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (diffMinutes < 1) {
    return t('sidebar.timestamp.justNow');
  }
  if (diffMinutes < 60) {
    return t('sidebar.timestamp.minutesAgo', { count: diffMinutes });
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return t('sidebar.timestamp.hoursAgo', { count: diffHours });
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return t('sidebar.timestamp.daysAgo', { count: diffDays });
  }

  return timestamp.toLocaleDateString();
};

const getChatTitle = (t: TranslateFn, chat: Pick<ChatHistoryItem, 'title_text'>) => {
  const title = chat.title_text?.trim();
  return title && title.length > 0 ? title : t('sidebar.history.untitled');
};

const ChatLoadingSkeleton: React.FC<{ t: TranslateFn }> = ({ t }) => (
  <div
    className="flex h-full flex-col gap-4 bg-white p-4"
    data-testid="chat-loading-skeleton"
    aria-label={t('sidebar.loadingChatConversation')}
  >
    <div className="space-y-2">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-3 w-48" />
    </div>
    <div className="space-y-3">
      <div className="ml-auto max-w-[78%] space-y-2 rounded-2xl bg-blue-50 p-3">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="max-w-[82%] space-y-2 rounded-2xl border border-gray-200 p-3">
        <Skeleton className="h-3 w-52" />
        <Skeleton className="h-3 w-44" />
        <Skeleton className="h-3 w-28" />
      </div>
      <div className="ml-auto max-w-[72%] space-y-2 rounded-2xl bg-blue-50 p-3">
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
    <div className="mt-auto rounded-2xl border border-gray-200 p-3">
      <Skeleton className="h-10 w-full" />
    </div>
  </div>
);

const RightSidebarContent: React.FC<RightSidebarProps> = ({
  isOpen,
  setIsOpen,
  clientUrl,
  accountId,
  messages: initialMessages,
  userRole,
  userId,
  selectedAccount,
  handleSelectAccount,
  auth_token,
  setChatTitle,
  isTitleLocked,
  handoffChatId,
  handoffNonce,
  onRequestClose,
  onInterruptibleStateChange,
  onRegisterCancelHandler,
}) => {
  const { t } = useTranslation('msp/chat');
  const [chatKey, setChatKey] = useState(0);
  const [width, setWidth] = useState(560);
  const [isResizing, setIsResizing] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChatMessages, setActiveChatMessages] = useState<any[]>([]);
  const [historyItems, setHistoryItems] = useState<ChatHistoryItem[]>([]);
  const [historyQuery, setHistoryQuery] = useState('');
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingHistoryChatId, setLoadingHistoryChatId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [hasActiveMessages, setHasActiveMessages] = useState(false);
  const [showNewChatConfirmation, setShowNewChatConfirmation] = useState(false);
  const [deleteTargetChat, setDeleteTargetChat] = useState<ChatHistoryItem | null>(null);
  const [isDeletingChat, setIsDeletingChat] = useState(false);
  const [renameTargetChat, setRenameTargetChat] = useState<ChatHistoryItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isRenamingChat, setIsRenamingChat] = useState(false);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(384);
  const activeChatIdRef = useRef<string | null>(null);
  const showHistoryRef = useRef(showHistory);
  const historyRequestSequenceRef = useRef(0);

  const trimmedHistoryQuery = historyQuery.trim();
  const isSearchMode = trimmedHistoryQuery.length > 0;
  const isSearchQueryTooShort =
    isSearchMode && trimmedHistoryQuery.length < MIN_HISTORY_SEARCH_CHARS;

  useEffect(() => {
    showHistoryRef.current = showHistory;
  }, [showHistory]);

  const invalidateHistoryRequests = useCallback(() => {
    historyRequestSequenceRef.current += 1;
  }, []);

  const resetChatSession = useCallback(() => {
    activeChatIdRef.current = null;
    setActiveChatId(null);
    setActiveChatMessages([]);
    setHasActiveMessages(false);
    setChatKey(prev => prev + 1);
  }, []);

  const loadHistory = useCallback(async (searchQuery: string) => {
    if (!userId) {
      invalidateHistoryRequests();
      setHistoryItems([]);
      setHistoryError(null);
      setIsHistoryLoading(false);
      return;
    }

    const requestSequence = historyRequestSequenceRef.current + 1;
    historyRequestSequenceRef.current = requestSequence;
    const trimmedQuery = searchQuery.trim();
    const nextMode = trimmedQuery.length === 0 ? 'recent' : 'search';

    setIsHistoryLoading(true);
    setHistoryError(null);
    try {
      const chats =
        nextMode === 'recent'
          ? await listCurrentUserChatsAction(HISTORY_LIMIT)
          : await searchCurrentUserChatsAction(trimmedQuery, HISTORY_LIMIT);

      if (historyRequestSequenceRef.current !== requestSequence) {
        return;
      }
      setHistoryItems(chats);
    } catch (error) {
      if (historyRequestSequenceRef.current !== requestSequence) {
        return;
      }
      console.error('[RightSidebarContent] Failed to load chat history', error);
      setHistoryError(
        nextMode === 'recent'
          ? t('sidebar.history.unableToLoadRecent')
          : t('sidebar.history.unableToLoadSearch'),
      );
    } finally {
      if (historyRequestSequenceRef.current === requestSequence) {
        setIsHistoryLoading(false);
      }
    }
  }, [userId, t]);

  const refreshActiveHistoryDataset = useCallback(() => {
    if (trimmedHistoryQuery.length > 0 && trimmedHistoryQuery.length < MIN_HISTORY_SEARCH_CHARS) {
      setIsHistoryLoading(false);
      setHistoryError(null);
      setHistoryItems([]);
      return;
    }
    void loadHistory(trimmedHistoryQuery);
  }, [invalidateHistoryRequests, loadHistory, trimmedHistoryQuery]);

  const loadPersistedChat = useCallback(async (chatId: string) => {
    if (!chatId) {
      return;
    }

    setLoadingHistoryChatId(chatId);
    activeChatIdRef.current = chatId;
    setActiveChatId(chatId);
    setActiveChatMessages([]);
    setHasActiveMessages(false);
    setChatKey(prev => prev + 1);

    try {
      const loaded = await getChatMessagesAction(chatId);
      setActiveChatMessages(loaded ?? []);
    } catch (error) {
      console.error('[RightSidebarContent] Failed to load selected chat messages', error);
      setActiveChatMessages([]);
    } finally {
      setLoadingHistoryChatId(null);
    }
  }, []);

  const handleNewChat = () => {
    if (hasActiveMessages) {
      setShowNewChatConfirmation(true);
      return;
    }

    resetChatSession();
  };

  const handleHideSidebar = () => {
    if (onRequestClose) {
      onRequestClose();
      return;
    }
    setIsOpen(false);
  };

  const handleChatIdChange = useCallback(
    (chatId: string | null) => {
      const nextChatId = chatId ?? null;
      if (activeChatIdRef.current === nextChatId) {
        return;
      }

      activeChatIdRef.current = nextChatId;
      setActiveChatId(nextChatId);

      if (nextChatId && showHistoryRef.current) {
        void loadHistory(trimmedHistoryQuery);
      }
    },
    [loadHistory, trimmedHistoryQuery]
  );

  void auth_token;

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizing) return;
      const delta = startXRef.current - event.clientX;
      const newWidth = Math.min(Math.max(startWidthRef.current + delta, 320), 800);
      if (newWidth !== width) {
        setWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, width]);

  const startResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsResizing(true);
    startXRef.current = event.clientX;
    startWidthRef.current = width;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  };

  useEffect(() => {
    if (!isOpen || !showHistory) {
      return;
    }

    if (trimmedHistoryQuery.length === 0) {
      void loadHistory('');
      return;
    }

    if (trimmedHistoryQuery.length < MIN_HISTORY_SEARCH_CHARS) {
      invalidateHistoryRequests();
      setIsHistoryLoading(false);
      setHistoryError(null);
      setHistoryItems([]);
      return;
    }

    const timer = setTimeout(() => {
      void loadHistory(trimmedHistoryQuery);
    }, HISTORY_SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [invalidateHistoryRequests, isOpen, showHistory, loadHistory, trimmedHistoryQuery]);

  useEffect(() => {
    if (!isOpen) {
      setShowHistory(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!handoffChatId) {
      return;
    }

    void loadPersistedChat(handoffChatId);
  }, [handoffChatId, handoffNonce, loadPersistedChat]);

  const messagesForChat = activeChatId ? activeChatMessages : initialMessages;
  const isChatLoading = loadingHistoryChatId !== null && loadingHistoryChatId === activeChatId;

  const handleRenameSubmit = async () => {
    if (!renameTargetChat) {
      return;
    }

    const nextTitle = renameValue.trim();
    if (!nextTitle.length) {
      return;
    }

    setIsRenamingChat(true);
    try {
      const renamed = await renameCurrentUserChatAction(renameTargetChat.id ?? '', nextTitle);
      if (!renamed) {
        return;
      }

      setHistoryItems((prev) =>
        prev.map((item) =>
          item.id === renameTargetChat.id
            ? {
                ...item,
                title_text: nextTitle,
              }
            : item
        )
      );
      setRenameTargetChat(null);
      setRenameValue('');
      refreshActiveHistoryDataset();
    } catch (error) {
      console.error('[RightSidebarContent] Failed to rename chat', error);
    } finally {
      setIsRenamingChat(false);
    }
  };

  const handleDeleteChat = async () => {
    if (!deleteTargetChat?.id) {
      return;
    }

    setIsDeletingChat(true);
    try {
      const deleted = await deleteCurrentUserChatAction(deleteTargetChat.id);
      if (!deleted) {
        return;
      }

      setHistoryItems((prev) => prev.filter((item) => item.id !== deleteTargetChat.id));
      if (activeChatId === deleteTargetChat.id) {
        resetChatSession();
      }
      setDeleteTargetChat(null);
      refreshActiveHistoryDataset();
    } catch (error) {
      console.error('[RightSidebarContent] Failed to delete chat', error);
    } finally {
      setIsDeletingChat(false);
    }
  };

  return (
    <Collapsible.Root
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          setIsOpen(true);
          return;
        }
        handleHideSidebar();
      }}
    >
      <Collapsible.Content
        style={{ width: `${width}px` }}
        ref={sidebarRef}
        className={`fixed top-0 right-0 z-[45] h-full bg-gray-50 shadow-xl overflow-hidden transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
      >
        <div
          role="separator"
          aria-orientation="vertical"
          className="absolute top-0 left-0 h-full w-1 cursor-col-resize z-10 transition-colors hover:bg-gray-300/40 active:bg-gray-400/40"
          onMouseDown={startResize}
          aria-hidden="true"
        />
        <div className="flex flex-col h-full border-l-2 border-gray-200 pl-1">
          <div className="bg-white border-b-2 border-gray-200">
            <div className="p-4 pb-3">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-gray-800">{t('sidebar.title')}</h2>
                  <p className="mt-1 text-xs text-gray-500">
                    {showHistory ? t('sidebar.subtitleHistory') : t('sidebar.subtitleDefault')}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className={[
                      'rounded p-1.5 transition-colors',
                      showHistory
                        ? 'bg-gray-200 text-gray-900'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
                    ].join(' ')}
                    onClick={() => setShowHistory((prev) => !prev)}
                    aria-label={showHistory ? t('sidebar.hideHistory') : t('sidebar.showHistory')}
                    title={showHistory ? t('sidebar.hideHistoryTooltip') : t('sidebar.showHistoryTooltip')}
                  >
                    <History className="h-4 w-4" />
                  </button>
                  <button
                    className="rounded p-1.5 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                    onClick={handleNewChat}
                    aria-label={t('sidebar.startNewChat')}
                    title={t('sidebar.startNewChat')}
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    className="rounded p-1.5 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
                    onClick={handleHideSidebar}
                    aria-label={t('sidebar.hideSidebar')}
                    title={t('sidebar.hideSidebarTooltip')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
            {showHistory ? (
              <div className="px-3 pb-3">
                <div className="rounded-xl border border-gray-200 bg-gray-50 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-gray-200 bg-white px-3 py-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {isSearchMode ? t('sidebar.history.searchResults') : t('sidebar.history.recentChats')}
                    </span>
                    <span className="text-xs text-gray-400">
                      {isHistoryLoading ? t('sidebar.history.loading') : `${historyItems.length}`}
                    </span>
                  </div>
                  <div className="border-b border-gray-200 bg-white px-3 py-2">
                    <Input
                      id="chat-history-search"
                      aria-label={t('sidebar.history.searchAriaLabel')}
                      placeholder={t('sidebar.history.searchPlaceholder')}
                      value={historyQuery}
                      onChange={(event) => setHistoryQuery(event.target.value)}
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto p-2 space-y-1">
                    {historyError ? (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                        {historyError}
                      </div>
                    ) : null}
                    {!historyError && !isHistoryLoading && isSearchQueryTooShort ? (
                      <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-3 text-xs text-gray-500">
                        {t('sidebar.history.typeAtLeastNChars', { count: MIN_HISTORY_SEARCH_CHARS })}
                      </div>
                    ) : null}
                    {!historyError && !isHistoryLoading && !isSearchMode && historyItems.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-3 text-xs text-gray-500">
                        {t('sidebar.history.emptyInitial')}
                      </div>
                    ) : null}
                    {!historyError &&
                    !isHistoryLoading &&
                    isSearchMode &&
                    !isSearchQueryTooShort &&
                    historyItems.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-3 text-xs text-gray-500">
                        {t('sidebar.history.emptySearch')}
                      </div>
                    ) : null}
                    {historyItems.map((chat) => {
                      const isActive = activeChatId === chat.id;
                      const preview = chat.preview_text?.trim() || t('sidebar.history.noMessagesYet');
                      return (
                        <div
                          key={chat.id}
                          className={[
                            'group flex items-start gap-2 rounded-lg border px-2 py-2 transition-colors',
                            isActive
                              ? 'border-blue-200 bg-blue-50'
                              : 'border-transparent bg-white hover:border-gray-200 hover:bg-gray-100',
                          ].join(' ')}
                        >
                          <button
                            className="min-w-0 flex-1 text-left"
                            onClick={() => {
                              if (!chat.id || chat.id === activeChatId) {
                                return;
                              }
                              void loadPersistedChat(chat.id);
                            }}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium text-gray-900">
                                {getChatTitle(t, chat)}
                              </span>
                              <span className="shrink-0 text-[11px] text-gray-400">
                                {formatHistoryTimestamp(t, chat.updated_at ?? chat.created_at)}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-gray-500 break-words">
                              {loadingHistoryChatId === chat.id ? t('sidebar.history.loadingConversation') : preview}
                            </p>
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="mt-0.5 rounded p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
                                aria-label={t('sidebar.history.chatActionsFor', { title: getChatTitle(t, chat) })}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[140px]">
                              <DropdownMenuItem
                                onSelect={() => {
                                  setRenameTargetChat(chat);
                                  setRenameValue(getChatTitle(t, chat));
                                }}
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                {t('sidebar.history.rename')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-red-600 focus:text-red-600"
                                onSelect={() => setDeleteTargetChat(chat)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                {t('sidebar.history.delete')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="p-4 bg-gray-100 text-sm text-gray-500 border-b border-gray-200">
              {t('sidebar.introMessage')}
            </div>
            <div className="flex flex-1 min-h-0">
              {isChatLoading ? (
                <ChatLoadingSkeleton t={t} />
              ) : (
                <Chat
                  key={chatKey}
                  clientUrl={clientUrl}
                  accountId={accountId}
                  messages={messagesForChat}
                  userRole={userRole}
                  userId={userId}
                  selectedAccount={selectedAccount}
                  handleSelectAccount={handleSelectAccount}
                  auth_token={auth_token}
                  setChatTitle={setChatTitle}
                  isTitleLocked={isTitleLocked}
                  onUserInput={() => void 0}
                  hf={null}
                  initialChatId={activeChatId}
                  onHasMessagesChange={setHasActiveMessages}
                  onChatIdChange={handleChatIdChange}
                  onInterruptibleStateChange={onInterruptibleStateChange}
                  onRegisterCancelHandler={onRegisterCancelHandler}
                />
              )}
            </div>
          </div>
        </div>
      </Collapsible.Content>
      <ConfirmationDialog
        id="confirm-new-chat"
        isOpen={showNewChatConfirmation}
        onClose={() => setShowNewChatConfirmation(false)}
        onConfirm={() => {
          setShowNewChatConfirmation(false);
          resetChatSession();
        }}
        title={t('sidebar.newChatConfirm.title')}
        message={t('sidebar.newChatConfirm.message')}
        confirmLabel={t('sidebar.newChatConfirm.confirmLabel')}
        cancelLabel={t('sidebar.newChatConfirm.cancelLabel')}
      />
      <ConfirmationDialog
        id="confirm-delete-chat"
        isOpen={deleteTargetChat !== null}
        onClose={() => setDeleteTargetChat(null)}
        onConfirm={handleDeleteChat}
        title={t('sidebar.deleteConfirm.title')}
        message={t('sidebar.deleteConfirm.messageWithTitle', {
          title: deleteTargetChat ? getChatTitle(t, deleteTargetChat) : t('sidebar.deleteConfirm.fallbackTitle'),
        })}
        confirmLabel={t('sidebar.deleteConfirm.confirmLabel')}
        cancelLabel={t('sidebar.deleteConfirm.cancelLabel')}
        isConfirming={isDeletingChat}
      />
      <Dialog
        id="rename-chat-dialog"
        isOpen={renameTargetChat !== null}
        onClose={() => {
          if (isRenamingChat) {
            return;
          }
          setRenameTargetChat(null);
          setRenameValue('');
        }}
        title={t('sidebar.rename.dialogTitle')}
        className="max-w-md"
        draggable={false}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button
              id="rename-chat-cancel"
              variant="outline"
              onClick={() => {
                setRenameTargetChat(null);
                setRenameValue('');
              }}
              disabled={isRenamingChat}
            >
              {t('sidebar.rename.cancel')}
            </Button>
            <Button
              id="rename-chat-save"
              onClick={() => void handleRenameSubmit()}
              disabled={isRenamingChat || renameValue.trim().length === 0}
            >
              {t('sidebar.rename.save')}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <Input
            id="rename-chat-input"
            label={t('sidebar.rename.inputLabel')}
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            placeholder={t('sidebar.rename.inputPlaceholder')}
            autoFocus
            disabled={isRenamingChat}
          />
        </DialogContent>
      </Dialog>
    </Collapsible.Root>
  );
};

export default RightSidebarContent;
