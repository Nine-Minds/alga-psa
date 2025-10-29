'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Image from 'next/image';

import { Message } from '../../components/message/Message';
import { IChat } from '../../interfaces/chat.interface';
import { createNewChatAction, addMessageToChatAction } from '../../lib/chat-actions/chatActions';
import { HfInference } from '@huggingface/inference';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';

import '../../components/chat/chat.css';

type ChatCompletionMessage = {
  role: 'user' | 'assistant' | 'function';
  content?: string;
  reasoning?: string;
  name?: string;
  function_call?: {
    name: string;
    arguments: Record<string, unknown>;
  };
  tool_call_id?: string;
};

type FunctionMetadata = {
  id: string;
  displayName: string;
  description?: string;
  rbacResource?: string;
  approvalRequired: boolean;
  playbooks?: string[];
  examples?: unknown[];
  arguments: Record<string, unknown>;
};

type FunctionCallInfo = {
  name: string;
  arguments: Record<string, unknown>;
  toolCallId?: string;
  entryId?: string;
};

type PendingFunctionState = {
  metadata: FunctionMetadata;
  assistantPreview: string;
  assistantReasoning?: string;
  functionCall: FunctionCallInfo;
  nextMessages: ChatCompletionMessage[];
  chatId?: string | null;
};

type ChatProps = {
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
  onUserInput: () => void;
  hf: HfInference;
};

const mapMessagesFromProps = (records: any[]): ChatCompletionMessage[] =>
  records.map((record: any) => ({
    role: record.chat_role === 'bot' ? 'assistant' : 'user',
    content: record.content ?? '',
    reasoning: record.reasoning ?? undefined,
  }));

export const Chat: React.FC<ChatProps> = ({
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
  onUserInput,
  hf,
}) => {
  const [messageText, setMessageText] = useState('');
  const [incomingMessage, setIncomingMessage] = useState('');
  const [generatingResponse, setGeneratingResponse] = useState(false);
  const [isFunction, setIsFunction] = useState(false);
  const [newChatMessages, setNewChatMessages] = useState<{
    _id: any;
    role: string;
    content: string;
    reasoning?: string;
  }[]>([]);
  const [fullMessage, setFullMessage] = useState('');
  const [fullReasoning, setFullReasoning] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(null);
  const [userMessageId, setUserMessageId] = useState<string | null>(null);
  const [botMessageId, setBotMessageId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ChatCompletionMessage[]>(() =>
    mapMessagesFromProps(messages),
  );
  const [pendingFunction, setPendingFunction] = useState<PendingFunctionState | null>(
    null,
  );
  const [isExecutingFunction, setIsExecutingFunction] = useState(false);
  const [pendingFunctionStatus, setPendingFunctionStatus] = useState<'idle' | 'awaiting' | 'executing'>('idle');
  const [pendingFunctionAction, setPendingFunctionAction] = useState<'none' | 'approve' | 'decline'>('none');
  const [functionError, setFunctionError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [showValidationDialog, setShowValidationDialog] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');

  const resolveMessageId = (candidate?: string | null) =>
    candidate ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `msg-${Date.now()}-${Math.random()}`);

  void accountId;
  void userRole;
  void selectedAccount;
  void handleSelectAccount;
  void auth_token;
  void setChatTitle;
  void isTitleLocked;
  void hf;

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  useEffect(() => {
    if (!generatingResponse && inputRef.current) {
      inputRef.current.focus();
    }
  }, [generatingResponse]);

  useEffect(() => {
    if (!generatingResponse && fullMessage) {
      setNewChatMessages((prev) => [
        ...prev,
        {
          _id: resolveMessageId(botMessageId),
          role: 'bot',
          content: fullMessage,
          reasoning: fullReasoning ?? undefined,
        },
      ]);
      setFullMessage('');
      setFullReasoning(null);
    }
  }, [generatingResponse, fullMessage, botMessageId, fullReasoning]);

  const autoResizeTextarea = useCallback(() => {
    if (!inputRef.current) {
      return;
    }
    const textarea = inputRef.current;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 320)}px`;
  }, []);

  useEffect(() => {
    autoResizeTextarea();
  }, [autoResizeTextarea]);

  useEffect(() => {
    if (!pendingFunction) {
      setPendingFunctionStatus('idle');
      setPendingFunctionAction('none');
    }
  }, [pendingFunction]);

  const closeValidationDialog = useCallback(() => {
    setShowValidationDialog(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setMessageText(value);
    requestAnimationFrame(autoResizeTextarea);
    if (onUserInput) {
      onUserInput();
    }
  };

  const addAssistantMessageToPersistence = async (
    chatIdentifier: string | null,
    content: string,
  ) => {
    if (!content || !chatIdentifier) {
      return;
    }

    try {
      const messageInfo = {
        chat_id: chatIdentifier,
        chat_role: 'bot' as const,
        content,
        thumb: null,
        feedback: null,
      };
      const saved = await addMessageToChatAction(messageInfo);
      setBotMessageId(saved._id || null);
    } catch (error) {
      console.error('Failed to persist assistant message', error);
    }
  };

  const sendMessage = () => {
    const trimmedMessage = messageText.trim();
    if (!trimmedMessage.length) {
      setValidationMessage('Please enter a message before sending.');
      setShowValidationDialog(true);
      return;
    }

    handleSend(trimmedMessage);

    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleClick = () => {
    sendMessage();
  };

  const handleStop = () => {
    setGeneratingResponse(false);
    setIsFunction(false);
    setIncomingMessage('');
    setPendingFunction(null);
    setIsExecutingFunction(false);
  };

  const handleSend = async (trimmedMessage: string) => {
    setFunctionError(null);
    setGeneratingResponse(true);
    setIsFunction(true);
    setIncomingMessage('Thinking...');

    if (!userId) {
      setGeneratingResponse(false);
      setIsFunction(false);
      setFunctionError('Unable to send message: user not identified.');
      return;
    }

    const userMessage: ChatCompletionMessage = {
      role: 'user',
      content: trimmedMessage,
    };

    const conversationWithUser = [...conversation, userMessage];
    setConversation(conversationWithUser);

    // Create new chat if needed and persist the user message
    let createdChatId: string | null = chatId;

    try {
      if (chatId == null) {
        const conversationInfo: Omit<IChat, 'tenant'> = {
          user_id: userId!,
          title_text: trimmedMessage,
          title_is_locked: false,
        };
        const created = await createNewChatAction(conversationInfo);
        if (created?._id) {
          createdChatId = created._id;
          setChatId(created._id);
        }
      }

      if (createdChatId) {
        const messageInfo = {
          chat_id: createdChatId,
          chat_role: 'user' as const,
          content: trimmedMessage,
          thumb: null,
          feedback: null,
        };
        const saved = await addMessageToChatAction(messageInfo);
        setUserMessageId(saved._id || null);
      }
    } catch (error) {
      console.error('Failed to persist user message', error);
      setFunctionError('Unable to save this message, continuing without persistence for now.');
    }

    setNewChatMessages((prev) => [
      ...prev,
      {
        _id: resolveMessageId(userMessageId),
        role: 'user',
        content: trimmedMessage,
      },
    ]);

    setMessageText('');
    if (inputRef.current) {
      inputRef.current.style.height = '';
      requestAnimationFrame(autoResizeTextarea);
    }

    try {
      const response = await fetch('/api/chat/v1/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: conversationWithUser,
          chatId: createdChatId,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || `Request failed with status ${response.status}`);
      }

      if (data.type === 'assistant_message') {
        const modelMessages = data.modelMessages ?? data.nextMessages;
        const assistantContentRaw = (data.message?.content ?? '').trim();
        const assistantReasoning: string | null = data.message?.reasoning ?? null;
        const finalAssistantContent =
          assistantContentRaw.length > 0
            ? assistantContentRaw
            : (assistantReasoning ?? '').trim();

        await addAssistantMessageToPersistence(
          createdChatId ?? chatId,
          finalAssistantContent,
        );
        setConversation(
          modelMessages ?? [
            ...conversationWithUser,
            {
              role: 'assistant',
              content: finalAssistantContent,
              reasoning: assistantReasoning ?? undefined,
            },
          ],
        );
        setFullMessage(finalAssistantContent);
        setFullReasoning(assistantReasoning);
        setIncomingMessage('');
        setIsFunction(false);
        setGeneratingResponse(false);
        setPendingFunctionStatus('idle');
        setPendingFunctionAction('none');
        setPendingFunction(null);
      } else if (data.type === 'function_proposed') {
        const modelMessages = data.modelMessages ?? data.nextMessages;
        setPendingFunction({
          metadata: data.function,
          assistantPreview: data.assistantPreview,
          assistantReasoning: data.assistantReasoning,
          functionCall: data.functionCall,
          nextMessages: modelMessages,
          chatId: createdChatId ?? chatId,
        });
        setConversation(modelMessages);
        setPendingFunctionStatus('awaiting');
        setPendingFunctionAction('none');
        setIncomingMessage('');
        setIsFunction(true);
        setGeneratingResponse(false);
      } else {
        throw new Error('Unexpected response from the assistant.');
      }
    } catch (error) {
      console.error('Error generating completion', error);
      setIncomingMessage('An error occurred while generating the response.');
      setIsFunction(false);
      setGeneratingResponse(false);
    }
  };

  const handleFunctionAction = async (action: 'approve' | 'decline') => {
    if (!pendingFunction) {
      return;
    }

    setFunctionError(null);
    setIsExecutingFunction(true);
    setIsFunction(true);
    setPendingFunctionStatus('executing');
    setPendingFunctionAction(action);
    setIncomingMessage('');

    try {
      const response = await fetch('/api/chat/v1/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: pendingFunction.nextMessages,
          functionCall: pendingFunction.functionCall,
          action,
          chatId: pendingFunction.chatId ?? chatId,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || `Request failed with status ${response.status}`);
      }

      if (data.type === 'assistant_message') {
        const modelMessages = data.modelMessages ?? data.nextMessages;
        const assistantContentRaw = (data.message?.content ?? '').trim();
        const assistantReasoning: string | null = data.message?.reasoning ?? null;
        let finalAssistantContent =
          assistantContentRaw.length > 0
            ? assistantContentRaw
            : (assistantReasoning ?? '').trim();

        if (finalAssistantContent.length === 0) {
          const preview = pendingFunction.assistantPreview?.trim() ?? '';
          finalAssistantContent =
            preview.length > 0 ? preview : 'The action completed without additional details.';
        }
        await addAssistantMessageToPersistence(
          pendingFunction.chatId ?? chatId,
          finalAssistantContent,
        );

        setConversation(
          modelMessages ?? [
            ...pendingFunction.nextMessages,
            {
              role: 'assistant',
              content: finalAssistantContent,
              reasoning: assistantReasoning ?? undefined,
            },
          ],
        );
        setFullMessage(finalAssistantContent);
        setFullReasoning(assistantReasoning);
        setIncomingMessage('');
        setIsFunction(false);
        setGeneratingResponse(false);
        setPendingFunctionStatus('idle');
        setPendingFunctionAction('none');
        setPendingFunction(null);
      } else if (data.type === 'function_proposed') {
        const modelMessages = data.modelMessages ?? data.nextMessages;
        setPendingFunction({
          metadata: data.function,
          assistantPreview: data.assistantPreview,
          assistantReasoning: data.assistantReasoning,
          functionCall: data.functionCall,
          nextMessages: modelMessages,
          chatId: pendingFunction.chatId ?? chatId,
        });
        setConversation(modelMessages);
        setPendingFunctionStatus('awaiting');
        setPendingFunctionAction('none');
        setIncomingMessage('');
        setIsFunction(true);
        setGeneratingResponse(false);
      } else {
        throw new Error('Unexpected response from the assistant.');
      }
      } catch (error) {
        console.error('Error executing function call', error);
        setFunctionError(
          error instanceof Error ? error.message : 'An unexpected error occurred.',
        );
        setPendingFunctionStatus('awaiting');
        setPendingFunctionAction('none');
        setIncomingMessage('');
        setIsFunction(true);
        setGeneratingResponse(false);
      } finally {
        setIsExecutingFunction(false);
      }
  };

  const displayMessages = [...messages, ...newChatMessages].filter(
    (message) => message.role !== 'function',
  );

  const callArgs = pendingFunction?.functionCall?.arguments ?? {};
  const method =
    typeof callArgs['method'] === 'string'
      ? (callArgs['method'] as string).toUpperCase()
      : 'GET';
  const path =
    typeof callArgs['path'] === 'string' ? (callArgs['path'] as string) : '';
  const endpointLabel = path
    ? `${method} ${path}`
    : pendingFunction?.functionCall?.entryId ?? pendingFunction?.metadata?.id ?? method;

  const formatArgumentKey = (key: string) =>
    key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());

  const formatArgumentValue = (value: unknown): string => {
    if (value === null || value === undefined) {
      return '—';
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return value.map((item) => formatArgumentValue(item)).join(', ');
      }
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        const nested = Object.entries(value as Record<string, unknown>);
        if (!nested.length) {
          return '{}';
        }
        return nested
          .map(([nestedKey, nestedValue]) => `${nestedKey}: ${formatArgumentValue(nestedValue)}`)
          .join(', ');
      }
    }
    return String(value);
  };

  const renderArgumentValue = (value: unknown) => {
    const formatted = formatArgumentValue(value);
    if (formatted === '—') {
      return formatted;
    }

    const isLongValue =
      formatted.length > 140 ||
      formatted.includes('\n') ||
      formatted.split(',').length > 6;

    if (!isLongValue) {
      return formatted;
    }

    return (
      <details className="function-arg-value-collapsible">
        <summary>View full value</summary>
        <pre className="function-arg-value-full">{formatted}</pre>
      </details>
    );
  };

  const pendingArgumentEntries = pendingFunction
    ? Object.entries(pendingFunction.metadata.arguments ?? {}).filter(([key]) => key !== 'entryId')
    : [];

  const sanitizeThinking = (text: string) =>
    text.replace(/<think>/gi, '').replace(/<\/think>/gi, '').trim();

  const extractPlanItems = (text: string): string[] => {
    if (!text) {
      return [];
    }

    const normalized = text
      .split(/\n+/)
      .map((segment) => segment.trim())
      .filter(Boolean)
      .flatMap((segment) => {
        const cleaned = segment.replace(/^[\d\s]*[\-\u2022\*\)]\s*/, '').replace(/^\d+\.\s*/, '');
        return cleaned
          .split(/(?<=\.)\s+(?=[A-Z])/)
          .map((part) => part.trim())
          .filter(Boolean);
      })
      .map((segment) => segment.replace(/^\d+\.\s*/, '').replace(/^[\-\u2022\*]\s*/, '').trim())
      .filter(Boolean);

    const unique: string[] = [];
    for (const segment of normalized) {
      const lower = segment.toLowerCase();
      if (!unique.some((existing) => existing.toLowerCase() === lower)) {
        unique.push(segment);
      }
    }

    return unique.slice(0, 4);
  };

  const previewText = sanitizeThinking(pendingFunction?.assistantPreview ?? '');
  const assistantPlanText = pendingFunction?.assistantReasoning
    ? sanitizeThinking(pendingFunction.assistantReasoning)
    : '';
  const assistantPlanItems = extractPlanItems(assistantPlanText);
  const statusText =
    pendingFunctionStatus === 'executing'
      ? pendingFunctionAction === 'approve'
        ? 'Executing request…'
        : 'Continuing without calling the function…'
      : 'Review and approve when you are ready.';

  return (
    <div className="chat-container">
      {!displayMessages.length && !incomingMessage && (
        <div className="m-auto justify-center flex items-center text-center h-64">
          <div className="initial-alga">
            <Image
              className="mb-6"
              src="/avatar-purple-no-shadow.svg"
              alt="Alga"
              width={150}
              height={150}
            />
            <h1 className="mt-6 text-2xl mx-1">
              I am Alga! Your favorite AI assistant. Ask me a question.
            </h1>
          </div>
        </div>
      )}

      {!!displayMessages.length && (
        <div className="chats">
          <div className="mb-auto w-full">
            {displayMessages.map((message, index) => (
              <Message
                key={message._id ?? message.tool_call_id ?? `msg-${index}`}
                messageId={message._id}
                role={message.role}
                content={message.content}
                clientUrl={clientUrl}
                reasoning={message.reasoning}
              />
            ))}
            {!!incomingMessage && (
              <Message role="bot" isFunction={isFunction} content={incomingMessage} />
            )}
          </div>
        </div>
      )}

      {pendingFunction && (
        <div className="function-approval-wrapper">
          <Image
            className="chat-img"
            src="/avatar-white.png"
            alt="Alga"
            width={18}
            height={18}
          />
          <div className="function-approval-bubble">
            <div className="function-approval-header">
              <span className="function-approval-badge">{method}</span>
              <span className="function-approval-endpoint">{endpointLabel}</span>
            </div>
            <h3 className="function-approval-title">
              {pendingFunction.metadata.displayName}
            </h3>
            {pendingFunction.metadata.description && (
              <p className="function-approval-description">
                {pendingFunction.metadata.description}
              </p>
            )}
            {previewText && (
              <p className="function-approval-preview">{previewText}</p>
            )}
            {assistantPlanText ? (
              <details className="function-approval-reasoning">
                <summary>View assistant plan</summary>
                {assistantPlanItems.length ? (
                  <ol className="function-approval-plan">
                    {assistantPlanItems.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ol>
                ) : (
                  <p>{assistantPlanText}</p>
                )}
              </details>
            ) : null}
            {pendingFunction.metadata.playbooks?.length ? (
              <div className="function-approval-playbooks">
                <span className="function-arg-key">Playbooks</span>
                <span className="function-arg-value">
                  {pendingFunction.metadata.playbooks.join(', ')}
                </span>
              </div>
            ) : null}
            {pendingArgumentEntries.length > 0 && (
              <div className="function-approval-arguments">
                <h4>Parameters</h4>
                <ul className="function-arg-list">
                  {pendingArgumentEntries.map(([key, value]) => (
                    <li key={key} className="function-arg-item">
                      <span className="function-arg-key">{formatArgumentKey(key)}</span>
                      <span className="function-arg-value">{renderArgumentValue(value)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {functionError && (
              <div className="function-approval-error">{functionError}</div>
            )}
            <div className="function-approval-status">{statusText}</div>
            <div className="function-approval-actions">
              <Button
                id="chat-approve-function"
                label="Approve function call"
                size="sm"
                variant="default"
                onClick={() => handleFunctionAction('approve')}
                disabled={isExecutingFunction}
              >
                {isExecutingFunction && pendingFunctionAction === 'approve'
                  ? 'Approving…'
                  : 'Approve'}
              </Button>
              <Button
                id="chat-decline-function"
                label="Decline function call"
                size="sm"
                variant="outline"
                onClick={() => handleFunctionAction('decline')}
                disabled={isExecutingFunction}
              >
                {isExecutingFunction && pendingFunctionAction === 'decline'
                  ? 'Processing…'
                  : 'Deny'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <footer className="chat-footer">
        <div className="input-container">
          <div className="input">
            <textarea
              ref={inputRef}
              value={messageText}
              onChange={handleInputChange}
              placeholder={generatingResponse ? 'Generating text...' : 'Send a message'}
              className="w-full resize-y rounded-md p-2 text-black min-h-[3rem]"
              onKeyDown={handleTextareaKeyDown}
              rows={3}
              disabled={generatingResponse || isFunction}
            />
            <p className="mt-1 text-xs text-gray-500">Press Ctrl+Enter or ⌘+Enter to send.</p>
          </div>

          <button
            onClick={generatingResponse ? handleStop : handleClick}
            type="submit"
            className={
              generatingResponse
                ? 'stop-btn rounded-md px-4 py-2 text-white'
                : 'send-btn rounded-md px-4 py-2 text-white'
            }
          >
            {generatingResponse ? 'STOP' : 'SEND'}
          </button>
        </div>
      </footer>

      <Dialog
        isOpen={showValidationDialog}
        onClose={closeValidationDialog}
        title="Message Required"
        id="chat-empty-message-dialog"
      >
        <DialogContent>
          <p className="text-sm text-gray-700">{validationMessage}</p>
        </DialogContent>
        <DialogFooter>
          <Button
            id="chat-empty-message-dialog-ok"
            onClick={closeValidationDialog}
          >
            OK
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
};

export default Chat;
