'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Search } from 'lucide-react';
import { Chat } from './Chat';
import { ChatMentionChip, type ChatMention } from './ChatMentionChip';
import { ChatMentionPopup, type ChatMentionPopupHandle } from './ChatMentionPopup';
import type { MentionableEntity } from '../../lib/chat-actions/searchEntitiesForMention';

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
  const { t } = useTranslation('msp/chat');
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [chatKey, setChatKey] = useState(0);
  const [autoSendPrompt, setAutoSendPrompt] = useState<string | null>(null);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [yoloEnabled, setYoloEnabled] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentions, setMentions] = useState<ChatMention[]>([]);
  const [initialMentions, setInitialMentions] = useState<ChatMention[]>([]);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const mentionPopupRef = useRef<ChatMentionPopupHandle | null>(null);

  const canOpenInSidebar = expanded && !!activeChatId;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setDraft('');
    setExpanded(false);
    setAutoSendPrompt(null);
    setActiveChatId(null);
    setYoloEnabled(false);
    setMentionQuery(null);
    setMentions([]);
    setInitialMentions([]);
    setChatKey((prev) => prev + 1);
    const focusTimer = setTimeout(() => draftRef.current?.focus(), 0);
    return () => clearTimeout(focusTimer);
  }, [isOpen]);

  const hintText = useMemo(() => {
    const modifier = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
      ? '⌘'
      : 'Ctrl';
    return t('quickAsk.hint', { modifier });
  }, [t]);

  const handleSubmit = () => {
    const prompt = draft.trim();
    if (!prompt) {
      return;
    }
    setInitialMentions(mentions);
    setExpanded(true);
    setAutoSendPrompt(prompt);
    setDraft('');
    setMentions([]);
    setMentionQuery(null);
  };

  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(value);

    // Detect @mention query — allow spaces so ticket titles / client names work.
    // Negative lookahead excludes already-confirmed mentions like "@Ticket: …".
    const cursorPos = e.target.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/(?:^|\s)@(?!\w+:\s)([^\n@]{0,60})$/);
    setMentionQuery(mentionMatch ? mentionMatch[1] : null);
  };

  const handleDraftKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionPopupRef.current) {
      const handled = mentionPopupRef.current.handleKeyDown(e);
      if (handled) return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleMentionSelect = useCallback(
    (entity: MentionableEntity) => {
      if (mentions.some((m) => m.type === entity.type && m.id === entity.id)) {
        setMentionQuery(null);
        return;
      }

      const typeLabel = entity.type.charAt(0).toUpperCase() + entity.type.slice(1);
      const displayText = `@${typeLabel}: ${entity.displayName}`;

      setMentions((prev) => [
        ...prev,
        { type: entity.type, id: entity.id, displayText },
      ]);

      const textarea = draftRef.current;
      if (textarea) {
        const cursorPos = textarea.selectionStart ?? draft.length;
        const textBeforeCursor = draft.slice(0, cursorPos);
        const atIndex = textBeforeCursor.lastIndexOf('@');
        if (atIndex !== -1) {
          const before = draft.slice(0, atIndex);
          const after = draft.slice(cursorPos);
          const newText = `${before}${displayText} ${after}`;
          setDraft(newText);

          requestAnimationFrame(() => {
            if (draftRef.current) {
              const newPos = before.length + displayText.length + 1;
              draftRef.current.selectionStart = newPos;
              draftRef.current.selectionEnd = newPos;
              draftRef.current.focus();
            }
          });
        }
      }

      setMentionQuery(null);
    },
    [mentions, draft],
  );

  const handleMentionRemove = useCallback((mention: ChatMention) => {
    setMentions((prev) => prev.filter((m) => !(m.type === mention.type && m.id === mention.id)));
  }, []);

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
      allowOverflow={!expanded}
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
          <div className="flex items-center gap-2 text-sm font-semibold text-[rgb(var(--color-text-800))]">
            <Search className="h-4 w-4 text-[rgb(var(--color-text-500))]" />
            {t('quickAsk.title')}
          </div>
          <div className="flex items-center gap-3">
            <div
              className={[
                'flex items-center gap-2 rounded-md px-2 py-1',
                yoloEnabled ? 'bg-destructive/10 ring-1 ring-destructive/30' : 'bg-muted ring-1 ring-border',
              ].join(' ')}
            >
              <span
                className={[
                  'text-xs font-bold tracking-wide',
                  yoloEnabled ? 'text-destructive' : 'text-[rgb(var(--color-text-600))]',
                ].join(' ')}
              >
                {t('quickAsk.yoloLabel')}
              </span>
              <Switch
                id="quick-ask-yolo"
                checked={yoloEnabled}
                onCheckedChange={(checked) => setYoloEnabled(Boolean(checked))}
                aria-label={t('quickAsk.yoloAriaLabel')}
              />
            </div>
            {expanded ? (
              <>
                <Button
                  id="quick-ask-open-in-sidebar"
                  size="sm"
                  variant="outline"
                  onClick={handleOpenInSidebar}
                  disabled={!canOpenInSidebar}
                >
                  {t('quickAsk.openInSidebar')}
                </Button>
                <Button
                  id="quick-ask-close"
                  size="sm"
                  variant="ghost"
                  onClick={onClose}
                >
                  {t('quickAsk.close')}
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {!expanded ? (
          <div className="relative">
            <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] shadow-sm overflow-hidden">
              <div className="flex items-start gap-3 px-4 py-3">
                <Search className="h-5 w-5 text-[rgb(var(--color-text-400))] mt-1" />
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  {mentions.length > 0 && (
                    <div className="chat-mention-chips">
                      {mentions.map((m) => (
                        <ChatMentionChip
                          key={`${m.type}-${m.id}`}
                          mention={m}
                          onRemove={handleMentionRemove}
                        />
                      ))}
                    </div>
                  )}
                  <textarea
                    ref={draftRef}
                    value={draft}
                    onChange={handleDraftChange}
                    onKeyDown={handleDraftKeyDown}
                    rows={2}
                    placeholder={t('quickAsk.inputPlaceholder')}
                    className="w-full resize-none bg-transparent text-base text-[rgb(var(--color-text-900))] placeholder:text-[rgb(var(--color-text-400))] focus:outline-none"
                    aria-label={t('quickAsk.inputAriaLabel')}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-[rgb(var(--color-border-100))] bg-[rgb(var(--color-card))] px-4 py-2">
                <div className="text-xs text-[rgb(var(--color-text-500))]">{hintText}</div>
                <Button
                  id="quick-ask-submit"
                  size="sm"
                  onClick={handleSubmit}
                  disabled={!draft.trim().length}
                >
                  {t('quickAsk.ask')}
                </Button>
              </div>
            </div>
            {mentionQuery !== null && (
              <ChatMentionPopup
                ref={mentionPopupRef}
                query={mentionQuery}
                onSelect={handleMentionSelect}
                onDismiss={() => setMentionQuery(null)}
                placement="below"
              />
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] shadow-sm overflow-hidden min-h-[520px]">
            <div className="px-4 py-3 border-b border-[rgb(var(--color-border-100))] bg-[rgb(var(--color-border-50))] text-xs text-[rgb(var(--color-text-600))] flex items-center justify-between">
              <span>{t('quickAsk.followUpNotice')}</span>
              {!activeChatId ? (
                <span className="text-[rgb(var(--color-text-400))]">{t('quickAsk.startingSession')}</span>
              ) : (
                <span className="text-[rgb(var(--color-text-400))]">{t('quickAsk.session', { chatId: activeChatId })}</span>
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
                initialMentions={initialMentions}
                onChatIdChange={setActiveChatId}
                autoApprovedHttpMethods={
                  yoloEnabled ? ['GET', 'POST', 'PUT', 'DELETE'] : undefined
                }
              />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
};

export default QuickAskOverlay;
