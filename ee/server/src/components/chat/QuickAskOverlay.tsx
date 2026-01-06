'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Search } from 'lucide-react';
import { Chat } from './Chat';

type QuickAskOverlayProps = {
  isOpen: boolean;
  onClose: () => void;
  onOpenInSidebar: (chatId: string) => void;

  clientUrl: string;
  accountId: string;
  messages: any[];
  userRole: string;
  userId: string | null;
  selectedAccount: string;
  handleSelectAccount: any;
  auth_token: string;
  setChatTitle: any;
  isTitleLocked: boolean;
  hf: any;
};

export const QuickAskOverlay: React.FC<QuickAskOverlayProps> = ({
  isOpen,
  onClose,
  onOpenInSidebar,
  clientUrl,
  accountId,
  messages,
  userRole,
  userId,
  selectedAccount,
  handleSelectAccount,
  auth_token,
  setChatTitle,
  isTitleLocked,
  hf,
}) => {
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [chatKey, setChatKey] = useState(0);
  const [autoSendPrompt, setAutoSendPrompt] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);

  const canOpenInSidebar = expanded && !!activeChatId;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setDraft('');
    setExpanded(false);
    setAutoSendPrompt(null);
    setActiveChatId(null);
    setChatKey((prev) => prev + 1);
    const t = setTimeout(() => draftRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [isOpen]);

  const hintText = useMemo(() => {
    const modifier = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
      ? '⌘'
      : 'Ctrl';
    return `Esc to close • Enter to ask • Shift+Enter for newline • ${modifier}+↑ to reopen`;
  }, []);

  const handleSubmit = () => {
    const prompt = draft.trim();
    if (!prompt) {
      return;
    }
    setExpanded(true);
    setAutoSendPrompt(prompt);
    setDraft('');
  };

  const handleDraftKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleOpenInSidebar = () => {
    if (!activeChatId) {
      return;
    }
    onOpenInSidebar(activeChatId);
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      draggable={false}
      hideCloseButton
      title=""
      id="quick-ask-overlay"
      className={[
        'transition-all duration-200 ease-out',
        expanded ? 'max-w-4xl' : 'max-w-2xl',
      ].join(' ')}
      onOpenAutoFocus={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <Search className="h-4 w-4 text-gray-500" />
            Quick Ask
          </div>
          {expanded && (
            <div className="flex items-center gap-2">
              <Button
                id="quick-ask-open-in-sidebar"
                size="sm"
                variant="outline"
                onClick={handleOpenInSidebar}
                disabled={!canOpenInSidebar}
              >
                Open in sidebar
              </Button>
              <Button
                id="quick-ask-close"
                size="sm"
                variant="ghost"
                onClick={onClose}
              >
                Close
              </Button>
            </div>
          )}
        </div>

        {!expanded ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 shadow-sm overflow-hidden">
            <div className="flex items-start gap-3 px-4 py-3">
              <Search className="h-5 w-5 text-gray-400 mt-1" />
              <textarea
                ref={draftRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleDraftKeyDown}
                rows={2}
                placeholder="Ask a quick question…"
                className="flex-1 resize-none bg-transparent text-base text-gray-900 placeholder:text-gray-400 focus:outline-none"
                aria-label="Quick Ask input"
              />
            </div>
            <div className="flex items-center justify-between border-t border-gray-100 bg-white px-4 py-2">
              <div className="text-xs text-gray-500">{hintText}</div>
              <Button
                id="quick-ask-submit"
                size="sm"
                onClick={handleSubmit}
                disabled={!draft.trim().length}
              >
                Ask
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden min-h-[520px]">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 text-xs text-gray-600 flex items-center justify-between">
              <span>Ask follow-ups below. This chat will be saved like sidebar chat.</span>
              {!activeChatId ? (
                <span className="text-gray-400">Starting session…</span>
              ) : (
                <span className="text-gray-400">Session: {activeChatId}</span>
              )}
            </div>
            <div className="px-3 py-3">
              <Chat
                key={chatKey}
                clientUrl={clientUrl}
                accountId={accountId}
                messages={messages}
                userRole={userRole}
                userId={userId}
                selectedAccount={selectedAccount}
                handleSelectAccount={handleSelectAccount}
                auth_token={auth_token}
                setChatTitle={setChatTitle}
                isTitleLocked={isTitleLocked}
                onUserInput={() => void 0}
                hf={hf}
                autoSendPrompt={autoSendPrompt}
                onChatIdChange={setActiveChatId}
              />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
};

export default QuickAskOverlay;

