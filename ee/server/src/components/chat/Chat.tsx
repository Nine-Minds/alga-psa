'use client';

import React, { useEffect, useRef, useState, useCallback, useId } from 'react';
import Image from 'next/image';
import { generateUUID } from '@alga-psa/core';

import { Message, type FunctionCallMeta } from '../../components/message/Message';
import { IChat } from '../../interfaces/chat.interface';
import {
  createNewChatAction,
  addMessageToChatAction,
} from '../../lib/chat-actions/chatActions';
import { HfInference } from '@huggingface/inference';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useAIChatContext } from '@product/chat/context';

import {
  readAssistantContentFromSse,
  type SseFunctionProposal,
} from './readAssistantContentFromSse';
import { ChatMentionChip, type ChatMention } from './ChatMentionChip';
import {
  ChatMentionPopup,
  type ChatMentionPopupHandle,
} from './ChatMentionPopup';
import type { MentionableEntity } from '../../lib/chat-actions/searchEntitiesForMention';

import './chat.css';

type ChatCompletionMessage = {
  role: 'user' | 'assistant' | 'function';
  content?: string;
  reasoning?: string;
  reasoning_content?: string;
  name?: string;
  function_call?: {
    name: string;
    arguments: Record<string, unknown>;
  };
  tool_call_id?: string;
};

type DisplayChatMessage = {
  _id?: string;
  role?: string;
  chat_role?: string;
  content?: string;
  reasoning?: string;
  reasoning_content?: string;
  status?: 'interrupted';
  statusDetail?: string;
  functionCallMeta?: FunctionCallMeta;
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
  toolResultTruncated?: boolean;
};

type PendingFunctionState = {
  metadata: FunctionMetadata;
  assistantPreview: string;
  assistantReasoning?: string;
  functionCall: FunctionCallInfo;
  nextMessages: ChatCompletionMessage[];
  chatId?: string | null;
};

const sanitizeThinking = (text: string) =>
  text.replace(/<think>/gi, '').replace(/<\/think>/gi, '').trim();

const determineHttpDetails = (fn: PendingFunctionState | null) => {
  if (!fn) {
    return {
      method: 'GET',
      normalizedMethod: undefined as string | undefined,
      isHttpMethod: false,
      endpointLabel: 'GET',
    };
  }

  const callArgs = fn.functionCall?.arguments ?? {};
  const metadataArgs = fn.metadata?.arguments ?? {};
  const methodValue =
    typeof callArgs['method'] === 'string'
      ? callArgs['method']
      : typeof metadataArgs['method'] === 'string'
        ? metadataArgs['method']
        : undefined;
  let normalizedMethod = methodValue ? methodValue.trim().toUpperCase() : undefined;

  if (!normalizedMethod) {
    const candidates = [
      fn.functionCall?.entryId,
      fn.metadata?.id,
      fn.functionCall?.name,
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') {
        continue;
      }
      const match = candidate.trim().match(/^[A-Za-z]+/);
      if (!match) {
        continue;
      }
      const inferred = match[0].toUpperCase();
      if (STANDARD_HTTP_METHOD_SET.has(inferred)) {
        normalizedMethod = inferred;
        break;
      }
    }
  }

  const method = normalizedMethod ?? 'GET';
  const isHttpMethod = STANDARD_HTTP_METHOD_SET.has(method);
  const effectiveNormalizedMethod = isHttpMethod ? method : undefined;

  const pathValue =
    typeof callArgs['path'] === 'string'
      ? callArgs['path']
      : typeof metadataArgs['path'] === 'string'
        ? metadataArgs['path']
        : undefined;

  const fallbackIdentifier =
    fn.functionCall?.entryId ??
    fn.metadata?.id ??
    fn.functionCall?.name ??
    method;

  let endpointLabel: string;
  if (pathValue) {
    endpointLabel = `${method} ${pathValue}`;
  } else {
    const stripped = fallbackIdentifier.replace(/^[A-Za-z]+-/, '');
    const normalizedPath = stripped.startsWith('_')
      ? stripped.replace(/_/g, '/')
      : stripped;
    const cleanedPath = normalizedPath
      .replace(/\/+/g, '/')
      .replace(/\/$/, '')
      .trim();
    if (cleanedPath.length > 0) {
      const prefixed = cleanedPath.startsWith('/') ? cleanedPath : `/${cleanedPath}`;
      endpointLabel = `${method} ${prefixed}`;
    } else {
      endpointLabel = fallbackIdentifier;
    }
  }

  return {
    method,
    normalizedMethod: effectiveNormalizedMethod,
    isHttpMethod,
    endpointLabel,
  };
};

const buildFunctionCallMeta = (
  fn: PendingFunctionState,
  action: 'approve' | 'decline',
  status: FunctionCallMeta['status'],
): FunctionCallMeta => {
  const httpDetails = determineHttpDetails(fn);
  return {
    displayName: fn.metadata.displayName ?? fn.functionCall?.name ?? 'Function call',
    method: httpDetails.method,
    endpoint: httpDetails.endpointLabel,
    action,
    status,
    timestamp: new Date().toISOString(),
    preview: sanitizeThinking(fn.assistantPreview ?? ''),
    notice:
      fn.functionCall.toolResultTruncated && action === 'approve'
        ? 'Result was too large and was truncated.'
        : undefined,
  };
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
  hf: HfInference | null;
  initialChatId?: string | null;
  autoSendPrompt?: string | null;
  initialMentions?: ChatMention[];
  onChatIdChange?: (chatId: string | null) => void;
  autoApprovedHttpMethods?: string[];
  onHasMessagesChange?: (hasMessages: boolean) => void;
  onInterruptibleStateChange?: (isInterruptible: boolean) => void;
  onRegisterCancelHandler?: (cancelHandler: (() => void) | null) => void;
};

const AUTO_APPROVED_METHODS_STORAGE_KEY = 'chat:autoApprovedHttpMethods';
const STANDARD_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const STANDARD_HTTP_METHOD_SET = new Set<string>(STANDARD_HTTP_METHODS);

const mapMessagesFromProps = (records: any[]): ChatCompletionMessage[] =>
  records.map((record: any) => ({
    role: record.chat_role === 'bot' ? 'assistant' : 'user',
    content: record.content ?? '',
    reasoning: record.reasoning ?? record.reasoning_content ?? undefined,
    reasoning_content: record.reasoning_content ?? record.reasoning ?? undefined,
  }));

const resolveDisplayMessageRole = (message: DisplayChatMessage): string => {
  if (typeof message.role === 'string' && message.role.trim().length > 0) {
    return message.role;
  }
  if (typeof message.chat_role === 'string' && message.chat_role.trim().length > 0) {
    return message.chat_role;
  }
  return '';
};

const mapDisplayMessageToCompletion = (
  message: DisplayChatMessage,
): ChatCompletionMessage | null => {
  const resolvedRole = resolveDisplayMessageRole(message);
  if (resolvedRole !== 'user' && resolvedRole !== 'bot' && resolvedRole !== 'assistant') {
    return null;
  }
  const assistantReasoning = message.reasoning ?? message.reasoning_content ?? undefined;
  return {
    role: resolvedRole === 'user' ? 'user' : 'assistant',
    content: message.content ?? '',
    reasoning: assistantReasoning,
    reasoning_content: assistantReasoning,
  };
};


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
  initialChatId,
  autoSendPrompt,
  initialMentions,
  onChatIdChange,
  autoApprovedHttpMethods,
  onHasMessagesChange,
  onInterruptibleStateChange,
  onRegisterCancelHandler,
}) => {
  const textareaId = useId();
  const [messageText, setMessageText] = useState('');
  const [incomingMessage, setIncomingMessage] = useState('');
  const [generatingResponse, setGeneratingResponse] = useState(false);
  const [isFunction, setIsFunction] = useState(false);
  const [newChatMessages, setNewChatMessages] = useState<
    {
      _id: any;
      role: string;
      content: string;
      reasoning?: string;
      functionCallMeta?: FunctionCallMeta;
      status?: 'interrupted';
      statusDetail?: string;
      tool_call_id?: string;
    }[]
  >([]);
  const [fullMessage, setFullMessage] = useState('');
  const [fullReasoning, setFullReasoning] = useState<string | null>(null);
  const [fullMessageStatus, setFullMessageStatus] = useState<'interrupted' | null>(null);
  const [fullMessageStatusDetail, setFullMessageStatusDetail] = useState<string | null>(
    null,
  );
  const [chatId, setChatId] = useState<string | null>(initialChatId ?? null);
  const [userMessageId, setUserMessageId] = useState<string | null>(null);
  const [persistedMessageCutoff, setPersistedMessageCutoff] = useState<number | null>(null);
  const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
  const [isMultilineMode, setIsMultilineMode] = useState(false);
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
  const [autoApprovedMethods, setAutoApprovedMethods] = useState<string[]>([]);
  const [mentions, setMentions] = useState<ChatMention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const mentionPopupRef = useRef<ChatMentionPopupHandle | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [showValidationDialog, setShowValidationDialog] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');
  const autoSendRef = useRef(false);
  const aiContext = useAIChatContext();
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const executeAbortControllerRef = useRef<AbortController | null>(null);
  const messageOrderRef = useRef<number>(0);
  const streamingTextRef = useRef<string | null>(null);
  const generationIdRef = useRef<number>(0);
  const pendingAssistantMessageIdRef = useRef<string | null>(null);
  const shouldAutoScrollRef = useRef(true);

  const SCROLL_BOTTOM_THRESHOLD_PX = 40;

  const resolveMessageId = (candidate?: string | null) =>
    candidate ?? generateUUID();

  const isNearBottom = useCallback((container: HTMLDivElement) => {
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD_PX;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = chatScrollRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
  }, []);

  const appendFunctionCallMarker = (
    fn: PendingFunctionState | null,
    action: 'approve' | 'decline',
    status: FunctionCallMeta['status'],
  ) => {
    if (!fn) {
      return;
    }
    const meta = buildFunctionCallMeta(fn, action, status);
    setNewChatMessages((prev) => [
      ...prev,
      {
        _id: resolveMessageId(),
        role: 'function-call',
        content: '',
        functionCallMeta: meta,
      },
    ]);
  };

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
    // Reset auto-approval preferences on component mount (new chat)
    const forcedMethods = (autoApprovedHttpMethods ?? [])
      .map((method) => method.trim().toUpperCase())
      .filter((method) => STANDARD_HTTP_METHOD_SET.has(method));
    setAutoApprovedMethods(forcedMethods);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(AUTO_APPROVED_METHODS_STORAGE_KEY);
      } catch (error) {
        console.error('Failed to clear auto-approved methods preference', error);
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      streamAbortControllerRef.current?.abort();
      executeAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const maxOrderFromRecords = Array.isArray(messages)
      ? Math.max(
          0,
          ...messages.map((record: any) =>
            typeof record?.message_order === 'number' ? record.message_order : 0,
          ),
        )
      : 0;
    messageOrderRef.current = Math.max(maxOrderFromRecords, Array.isArray(messages) ? messages.length : 0);
  }, [messages]);

  useEffect(() => {
    onChatIdChange?.(chatId);
  }, [chatId, onChatIdChange]);

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
          _id: resolveMessageId(pendingAssistantMessageIdRef.current),
          role: 'bot',
          content: fullMessage,
          reasoning: fullReasoning ?? undefined,
          functionCallMeta: undefined,
          status: fullMessageStatus ?? undefined,
          statusDetail: fullMessageStatusDetail ?? undefined,
        },
      ]);
      pendingAssistantMessageIdRef.current = null;
      setFullMessage('');
      setFullReasoning(null);
      setFullMessageStatus(null);
      setFullMessageStatusDetail(null);
    }
  }, [
    generatingResponse,
    fullMessage,
    fullReasoning,
    fullMessageStatus,
    fullMessageStatusDetail,
  ]);

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

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container) {
      return;
    }

    shouldAutoScrollRef.current = isNearBottom(container);
  }, [isNearBottom]);

  const closeValidationDialog = useCallback(() => {
    setShowValidationDialog(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setMessageText(value);
    if (!isMultilineMode && value.includes('\n')) {
      setIsMultilineMode(true);
    }
    requestAnimationFrame(autoResizeTextarea);

    // Detect @mention query — allow spaces so ticket titles / client names work.
    // Negative lookahead excludes already-confirmed mentions like "@Ticket: …".
    const cursorPos = e.target.selectionStart ?? value.length;
    const textBeforeCursor = value.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/(?:^|\s)@(?!\w+:\s)([^\n@]{0,60})$/);
    setMentionQuery(mentionMatch ? mentionMatch[1] : null);

    if (onUserInput) {
      onUserInput();
    }
  };

  const addAssistantMessageToPersistence = useCallback(async (
    chatIdentifier: string | null,
    content: string,
    messageOrder?: number,
  ): Promise<string | null> => {
    if (!content || !chatIdentifier) {
      return null;
    }

    try {
      const messageInfo = {
        chat_id: chatIdentifier,
        chat_role: 'bot' as const,
        content,
        thumb: null,
        feedback: null,
        message_order: messageOrder,
      };
      const saved = await addMessageToChatAction(messageInfo);
      return saved._id || null;
    } catch (error) {
      console.error('Failed to persist assistant message', error);
      return null;
    }
  }, []);

  const handleAutoApprovePreferenceChange = useCallback(
    (methodName: string, enabled: boolean) => {
      const normalized = methodName.toUpperCase();
      if (!STANDARD_HTTP_METHOD_SET.has(normalized)) {
        return;
      }

      setAutoApprovedMethods((prev) => {
        if (enabled) {
          if (prev.includes(normalized)) {
            return prev;
          }
          const next = [...prev, normalized];
          return next;
        }

        const next = prev.filter((value) => value !== normalized);
        if (next.length !== prev.length) {
          return next;
        }

        return prev;
      });
    },
    [],
  );

  const handleMentionSelect = useCallback(
    (entity: MentionableEntity) => {
      // Avoid duplicate mentions
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

      // Replace @query text in the textarea with the display text
      const textarea = inputRef.current;
      if (textarea) {
        const cursorPos = textarea.selectionStart ?? messageText.length;
        const textBeforeCursor = messageText.slice(0, cursorPos);
        const atIndex = textBeforeCursor.lastIndexOf('@');
        if (atIndex !== -1) {
          const before = messageText.slice(0, atIndex);
          const after = messageText.slice(cursorPos);
          const newText = `${before}${displayText} ${after}`;
          setMessageText(newText);

          // Set cursor position after the inserted text
          requestAnimationFrame(() => {
            if (inputRef.current) {
              const newPos = before.length + displayText.length + 1;
              inputRef.current.selectionStart = newPos;
              inputRef.current.selectionEnd = newPos;
              inputRef.current.focus();
            }
          });
        }
      }

      setMentionQuery(null);
    },
    [mentions, messageText],
  );

  const handleMentionRemove = useCallback((mention: ChatMention) => {
    setMentions((prev) => prev.filter((m) => !(m.type === mention.type && m.id === mention.id)));
  }, []);

  const sendMessage = () => {
    const trimmedMessage = messageText.trim();
    if (!trimmedMessage.length) {
      setValidationMessage('Please enter a message before sending.');
      setShowValidationDialog(true);
      return;
    }

    if (editingMessageIndex !== null) {
      handleEditAndResendFromMessage(editingMessageIndex, trimmedMessage);
    } else {
      handleSend(trimmedMessage);
    }

    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // When mention popup is active, delegate navigation keys to it
    if (mentionQuery !== null && mentionPopupRef.current) {
      const handled = mentionPopupRef.current.handleKeyDown(e);
      if (handled) return;
    }

    if (e.key !== 'Enter') {
      return;
    }

    const commandSend = e.metaKey || e.ctrlKey;

    if (isMultilineMode) {
      if (!commandSend) {
        return;
      }
      e.preventDefault();
      sendMessage();
      return;
    }

    if (e.shiftKey) {
      setIsMultilineMode(true);
      return;
    }

    e.preventDefault();
    sendMessage();
  };

  const handleClick = () => {
    sendMessage();
  };

  const handleStop = useCallback(() => {
    generationIdRef.current += 1;
    streamAbortControllerRef.current?.abort();
    streamAbortControllerRef.current = null;
    pendingAssistantMessageIdRef.current = null;
    if (streamingTextRef.current) {
      setIncomingMessage('');
      setFullMessageStatus(null);
      setFullMessageStatusDetail(null);
      setFullMessage(streamingTextRef.current);
      streamingTextRef.current = null;
    }
    executeAbortControllerRef.current?.abort();
    executeAbortControllerRef.current = null;
    setGeneratingResponse(false);
    setIsFunction(false);
    setPendingFunctionStatus(pendingFunction ? 'awaiting' : 'idle');
    setPendingFunctionAction('none');
    setIsExecutingFunction(false);
  }, [pendingFunction]);

  const handleSend = useCallback(async (
    trimmedMessage: string,
    options?: {
      reuseExistingUserMessage?: boolean;
      baseConversation?: ChatCompletionMessage[];
      mentionsOverride?: ChatMention[];
    },
  ) => {
    const reuseExistingUserMessage = options?.reuseExistingUserMessage ?? false;
    setFunctionError(null);
    setEditingMessageIndex(null);
    setFullMessageStatus(null);
    setFullMessageStatusDetail(null);
    setFullReasoning(null);
    setIsMultilineMode(false);
    pendingAssistantMessageIdRef.current = null;
    setGeneratingResponse(true);
    setIsFunction(true);
    setIncomingMessage('Thinking...');

    if (!userId) {
      setGeneratingResponse(false);
      setIsFunction(false);
      setFunctionError('Unable to send message: user not identified.');
      return;
    }

    const baseConversation = options?.baseConversation ?? conversation;
    const userMessage: ChatCompletionMessage = { role: 'user', content: trimmedMessage };
    const conversationWithUser = reuseExistingUserMessage
      ? baseConversation
      : [...baseConversation, userMessage];
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

      if (createdChatId && !reuseExistingUserMessage) {
        const order = messageOrderRef.current + 1;
        messageOrderRef.current = order;
        const messageInfo = {
          chat_id: createdChatId,
          chat_role: 'user' as const,
          content: trimmedMessage,
          thumb: null,
          feedback: null,
          message_order: order,
        };
        const saved = await addMessageToChatAction(messageInfo);
        setUserMessageId(saved._id || null);
      }
    } catch (error) {
      console.error('Failed to persist user message', error);
      setFunctionError('Unable to save this message, continuing without persistence for now.');
    }

    if (!reuseExistingUserMessage) {
      setNewChatMessages((prev) => [
        ...prev,
        {
          _id: resolveMessageId(userMessageId),
          role: 'user',
          content: trimmedMessage,
          functionCallMeta: undefined,
        },
      ]);
    }

    // Send all mentions that have chips visible — user controls removal via chip X button
    const activeMentions = options?.mentionsOverride ?? mentions;

    setMessageText('');
    setMentions([]);
    setMentionQuery(null);
    setIsMultilineMode(false);
    if (inputRef.current) {
      inputRef.current.style.height = '';
      requestAnimationFrame(autoResizeTextarea);
    }

    try {
      const generationId = generationIdRef.current + 1;
      generationIdRef.current = generationId;

      streamAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      streamAbortControllerRef.current = abortController;

      const response = await fetch('/api/chat/v1/completions/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: conversationWithUser,
          uiContext: aiContext,
          ...(activeMentions.length > 0
            ? { mentions: activeMentions.map((m) => ({ type: m.type, id: m.id })) }
            : {}),
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        let errorMessage = `Request failed with status ${response.status}`;
        try {
          const data = await response.json();
          if (data?.error) {
            errorMessage = data.error;
          }
        } catch {
          // best-effort
        }
        throw new Error(errorMessage);
      }

      streamingTextRef.current = '';
      let renderScheduled = false;
      let sawToken = false;
      let shouldContinueStreaming = true;
      let streamedFunctionProposal: PendingFunctionState | null = null;
      let streamedReasoning: string | null = null;

      const scheduleIncomingRender = () => {
        if (renderScheduled) {
          return;
        }
        renderScheduled = true;
        requestAnimationFrame(() => {
          renderScheduled = false;
          if (generationIdRef.current !== generationId) {
            return;
          }
          setIncomingMessage(streamingTextRef.current ?? '');
        });
      };

      const { content: finalAssistantContent, doneReceived } =
        await readAssistantContentFromSse(response, {
          shouldContinue: () =>
            generationIdRef.current === generationId && shouldContinueStreaming,
          onToken: (_token, accumulated) => {
            streamingTextRef.current = accumulated;
            if (!sawToken) {
              sawToken = true;
              setIsFunction(false);
            }
            scheduleIncomingRender();
          },
          onReasoning: (_token, accumulated) => {
            if (generationIdRef.current !== generationId) {
              return;
            }
            streamedReasoning = accumulated;
            setFullReasoning(accumulated);
          },
          onToolCalls: (proposal: SseFunctionProposal) => {
            const modelMessages = (proposal.modelMessages ??
              proposal.nextMessages) as ChatCompletionMessage[];
            streamedFunctionProposal = {
              metadata: proposal.function,
              assistantPreview: proposal.assistantPreview,
              assistantReasoning: proposal.assistantReasoning,
              functionCall: proposal.functionCall,
              nextMessages: modelMessages,
              chatId: createdChatId ?? chatId,
            };
            shouldContinueStreaming = false;
          },
        });

      if (generationIdRef.current !== generationId) {
        return;
      }

      if (streamedFunctionProposal) {
        setConversation(streamedFunctionProposal.nextMessages);
        setPendingFunction(streamedFunctionProposal);
        setPendingFunctionStatus('awaiting');
        setPendingFunctionAction('none');
        setIncomingMessage('');
        setIsFunction(true);
        setGeneratingResponse(false);
        streamingTextRef.current = null;
        streamAbortControllerRef.current = null;
        return;
      }

      const wasInterrupted = !doneReceived;
      if (!wasInterrupted) {
        const assistantOrder = messageOrderRef.current + 1;
        messageOrderRef.current = assistantOrder;
        const persistedMessageId = await addAssistantMessageToPersistence(
          createdChatId ?? chatId,
          finalAssistantContent,
          assistantOrder,
        );
        pendingAssistantMessageIdRef.current = persistedMessageId;
        setFullMessageStatus(null);
        setFullMessageStatusDetail(null);
      } else {
        setFullMessageStatus('interrupted');
        setFullMessageStatusDetail('Connection interrupted — showing partial response.');
      }

      setFullReasoning(streamedReasoning);
      const assistantReasoning = streamedReasoning ?? undefined;
      setConversation([
        ...conversationWithUser,
        {
          role: 'assistant',
          content: finalAssistantContent,
          reasoning: assistantReasoning,
          reasoning_content: assistantReasoning,
        },
      ]);

      setIsFunction(false);
      setIncomingMessage('');
      streamingTextRef.current = null;
      streamAbortControllerRef.current = null;
      setFullMessage(finalAssistantContent);
      setGeneratingResponse(false);
      setPendingFunctionStatus('idle');
      setPendingFunctionAction('none');
      setPendingFunction(null);
    } catch (error) {
      if (
        streamAbortControllerRef.current?.signal.aborted ||
        (typeof error === 'object' &&
          error != null &&
          'name' in error &&
          (error as { name?: unknown }).name === 'AbortError')
      ) {
        return;
      }
      console.error('Error generating completion', error);
      const partial = streamingTextRef.current ?? '';
      if (partial.trim().length > 0) {
        pendingAssistantMessageIdRef.current = null;
        setIncomingMessage('');
        setFullMessageStatus('interrupted');
        setFullMessageStatusDetail(
          error instanceof Error
            ? `Connection interrupted — ${error.message}`
            : 'Connection interrupted — showing partial response.',
        );
        setFullMessage(partial);
      } else {
        setIncomingMessage('An error occurred while generating the response.');
      }

      streamingTextRef.current = null;
      streamAbortControllerRef.current = null;
      setIsFunction(false);
      setGeneratingResponse(false);
    }
  }, [
    chatId,
    conversation,
    userId,
    userMessageId,
    autoResizeTextarea,
    addAssistantMessageToPersistence,
    aiContext,
    mentions,
  ]);

  useEffect(() => {
    if (!autoSendPrompt) {
      return;
    }
    if (autoSendRef.current) {
      return;
    }
    const prompt = autoSendPrompt.trim();
    if (!prompt.length) {
      return;
    }
    autoSendRef.current = true;
    void handleSend(prompt, { mentionsOverride: initialMentions });
  }, [autoSendPrompt, handleSend, initialMentions]);

  const handleFunctionAction = useCallback(async (action: 'approve' | 'decline') => {
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
      executeAbortControllerRef.current?.abort();
      const executeAbortController = new AbortController();
      executeAbortControllerRef.current = executeAbortController;

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
          uiContext: aiContext,
        }),
        signal: executeAbortController.signal,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || `Request failed with status ${response.status}`);
      }

      const outcomeStatus: FunctionCallMeta['status'] =
        action === 'decline'
          ? 'declined'
          : data.type === 'assistant_message'
            ? 'success'
            : 'pending';
      const completedFunctionState: PendingFunctionState =
        data.type === 'assistant_message' && data.functionCall
          ? {
              ...pendingFunction,
              functionCall: {
                ...pendingFunction.functionCall,
                ...data.functionCall,
              },
            }
          : pendingFunction;
      appendFunctionCallMarker(completedFunctionState, action, outcomeStatus);

      if (data.type === 'assistant_message') {
        const modelMessages = data.modelMessages ?? data.nextMessages;
        const assistantContentRaw = (data.message?.content ?? '').trim();
        const assistantReasoning: string | null =
          data.message?.reasoning_content ?? data.message?.reasoning ?? null;
        let finalAssistantContent =
          assistantContentRaw.length > 0
            ? assistantContentRaw
            : (assistantReasoning ?? '').trim();

        if (finalAssistantContent.length === 0) {
          const preview = pendingFunction.assistantPreview?.trim() ?? '';
          finalAssistantContent =
            preview.length > 0 ? preview : 'The action completed without additional details.';
        }
        const assistantOrder = messageOrderRef.current + 1;
        messageOrderRef.current = assistantOrder;
        const persistedMessageId = await addAssistantMessageToPersistence(
          pendingFunction.chatId ?? chatId,
          finalAssistantContent,
          assistantOrder,
        );
        pendingAssistantMessageIdRef.current = persistedMessageId;

        setConversation(
          modelMessages ?? [
            ...pendingFunction.nextMessages,
            {
              role: 'assistant',
              content: finalAssistantContent,
              reasoning: assistantReasoning ?? undefined,
              reasoning_content: assistantReasoning ?? undefined,
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
      if (
        executeAbortControllerRef.current?.signal.aborted ||
        (typeof error === 'object' &&
          error != null &&
          'name' in error &&
          (error as { name?: unknown }).name === 'AbortError')
      ) {
        setPendingFunctionStatus('awaiting');
        setPendingFunctionAction('none');
        setIncomingMessage('');
        setIsFunction(true);
        setGeneratingResponse(false);
        return;
      }

      console.error('Error executing function call', error);
      appendFunctionCallMarker(pendingFunction, action, 'error');
      setFunctionError(
        error instanceof Error ? error.message : 'An unexpected error occurred.',
      );
      setPendingFunctionStatus('awaiting');
      setPendingFunctionAction('none');
      setIncomingMessage('');
      setIsFunction(true);
      setGeneratingResponse(false);
    } finally {
      executeAbortControllerRef.current = null;
      setIsExecutingFunction(false);
    }
  }, [pendingFunction, chatId, addAssistantMessageToPersistence, aiContext]);

  const persistedDisplayMessages = (messages as DisplayChatMessage[]).filter(
    (message) => resolveDisplayMessageRole(message) !== 'function',
  );
  const activePersistedCount =
    persistedMessageCutoff == null
      ? persistedDisplayMessages.length
      : Math.min(persistedMessageCutoff, persistedDisplayMessages.length);
  const activePersistedMessages = persistedDisplayMessages.slice(0, activePersistedCount);
  const displayMessages = [...activePersistedMessages, ...newChatMessages].filter(
    (message) => resolveDisplayMessageRole(message as DisplayChatMessage) !== 'function',
  );
  const hasVisibleMessages =
    displayMessages.length > 0 ||
    incomingMessage.trim().length > 0 ||
    fullMessage.trim().length > 0;

  useEffect(() => {
    if (!shouldAutoScrollRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      if (!shouldAutoScrollRef.current) {
        return;
      }
      scrollToBottom();
    });
  }, [
    displayMessages.length,
    incomingMessage,
    pendingFunction,
    functionError,
    fullMessage,
    fullReasoning,
    scrollToBottom,
  ]);

  useEffect(() => {
    onHasMessagesChange?.(hasVisibleMessages);
  }, [hasVisibleMessages, onHasMessagesChange]);

  const handleRetryFromMessage = useCallback(
    (messageIndex: number) => {
      if (generatingResponse || isFunction || isExecutingFunction || pendingFunction) {
        return;
      }

      const selectedMessage = displayMessages[messageIndex] as DisplayChatMessage | undefined;
      if (!selectedMessage || resolveDisplayMessageRole(selectedMessage) !== 'user') {
        return;
      }

      const messageContent = (selectedMessage.content ?? '').trim();
      if (!messageContent.length) {
        return;
      }

      const replayWindow = displayMessages.slice(0, messageIndex + 1) as DisplayChatMessage[];
      const replayConversation = replayWindow
        .map(mapDisplayMessageToCompletion)
        .filter((message): message is ChatCompletionMessage => message != null);

      if (!replayConversation.length || replayConversation.at(-1)?.role !== 'user') {
        return;
      }

      streamAbortControllerRef.current?.abort();
      streamAbortControllerRef.current = null;
      streamingTextRef.current = null;
      pendingAssistantMessageIdRef.current = null;

      if (messageIndex < activePersistedCount) {
        setPersistedMessageCutoff(messageIndex + 1);
        setNewChatMessages([]);
      } else {
        const nextNewMessageCount = messageIndex - activePersistedCount + 1;
        setNewChatMessages((prev) => prev.slice(0, nextNewMessageCount));
      }

      setPendingFunction(null);
      setPendingFunctionStatus('idle');
      setPendingFunctionAction('none');
      setFunctionError(null);
      setEditingMessageIndex(null);
      setIncomingMessage('');
      setFullMessage('');
      setFullReasoning(null);
      setFullMessageStatus(null);
      setFullMessageStatusDetail(null);

      void handleSend(messageContent, {
        reuseExistingUserMessage: true,
        baseConversation: replayConversation,
      });
    },
    [
      generatingResponse,
      isFunction,
      isExecutingFunction,
      pendingFunction,
      displayMessages,
      activePersistedCount,
      handleSend,
    ],
  );

  const handleEditMessage = useCallback(
    (messageIndex: number) => {
      if (generatingResponse || isFunction || isExecutingFunction || pendingFunction) {
        return;
      }

      const selectedMessage = displayMessages[messageIndex] as DisplayChatMessage | undefined;
      if (!selectedMessage || resolveDisplayMessageRole(selectedMessage) !== 'user') {
        return;
      }

      const editableContent = (selectedMessage.content ?? '').trim();
      if (!editableContent.length) {
        return;
      }

      setEditingMessageIndex(messageIndex);
      setMessageText(editableContent);
      setIsMultilineMode(editableContent.includes('\n'));
      requestAnimationFrame(() => {
        autoResizeTextarea();
        inputRef.current?.focus();
      });
    },
    [
      generatingResponse,
      isFunction,
      isExecutingFunction,
      pendingFunction,
      displayMessages,
      autoResizeTextarea,
    ],
  );

  const handleEditAndResendFromMessage = useCallback(
    (messageIndex: number, updatedMessage: string) => {
      if (generatingResponse || isFunction || isExecutingFunction || pendingFunction) {
        return;
      }

      const selectedMessage = displayMessages[messageIndex] as DisplayChatMessage | undefined;
      if (!selectedMessage || resolveDisplayMessageRole(selectedMessage) !== 'user') {
        return;
      }

      const replacementContent = updatedMessage.trim();
      if (!replacementContent.length) {
        setValidationMessage('Please enter a message before sending.');
        setShowValidationDialog(true);
        return;
      }

      const replayWindow = displayMessages
        .slice(0, messageIndex + 1)
        .map((message, index) =>
          index === messageIndex
            ? { ...message, content: replacementContent }
            : message,
        ) as DisplayChatMessage[];

      const replayConversation = replayWindow
        .map(mapDisplayMessageToCompletion)
        .filter((message): message is ChatCompletionMessage => message != null);

      if (!replayConversation.length || replayConversation.at(-1)?.role !== 'user') {
        return;
      }

      streamAbortControllerRef.current?.abort();
      streamAbortControllerRef.current = null;
      streamingTextRef.current = null;
      pendingAssistantMessageIdRef.current = null;

      if (messageIndex < activePersistedCount) {
        setPersistedMessageCutoff(messageIndex);
        setNewChatMessages([
          {
            _id: resolveMessageId(selectedMessage._id),
            role: 'user',
            content: replacementContent,
            functionCallMeta: undefined,
          },
        ]);
      } else {
        const nextNewMessageCount = messageIndex - activePersistedCount;
        setNewChatMessages((prev) => [
          ...prev.slice(0, Math.max(0, nextNewMessageCount)),
          {
            _id: resolveMessageId(selectedMessage._id),
            role: 'user',
            content: replacementContent,
            functionCallMeta: undefined,
          },
        ]);
      }

      setPendingFunction(null);
      setPendingFunctionStatus('idle');
      setPendingFunctionAction('none');
      setFunctionError(null);
      setEditingMessageIndex(null);
      setIncomingMessage('');
      setFullMessage('');
      setFullReasoning(null);
      setFullMessageStatus(null);
      setFullMessageStatusDetail(null);
      setIsMultilineMode(false);

      void handleSend(replacementContent, {
        reuseExistingUserMessage: true,
        baseConversation: replayConversation,
      });
    },
    [
      generatingResponse,
      isFunction,
      isExecutingFunction,
      pendingFunction,
      displayMessages,
      activePersistedCount,
      handleSend,
    ],
  );

  const handleCancelEdit = useCallback(() => {
    setEditingMessageIndex(null);
    setMessageText('');
    setIsMultilineMode(false);
    requestAnimationFrame(() => {
      autoResizeTextarea();
      inputRef.current?.focus();
    });
  }, [autoResizeTextarea]);

  const canModifyHistory =
    !generatingResponse && !isFunction && !isExecutingFunction && !pendingFunction;
  const canStop = generatingResponse || isExecutingFunction;

  const handleChatScroll = useCallback(() => {
    const container = chatScrollRef.current;
    if (!container) {
      return;
    }

    shouldAutoScrollRef.current = isNearBottom(container);
  }, [isNearBottom]);

  useEffect(() => {
    onInterruptibleStateChange?.(canStop);
  }, [canStop, onInterruptibleStateChange]);

  useEffect(() => {
    onRegisterCancelHandler?.(handleStop);
    return () => {
      onRegisterCancelHandler?.(null);
    };
  }, [handleStop, onRegisterCancelHandler]);

  const { method, normalizedMethod, isHttpMethod, endpointLabel } = determineHttpDetails(pendingFunction);
  const autoApprovalEnabledForMethod =
    normalizedMethod !== undefined
      ? autoApprovedMethods.includes(normalizedMethod)
      : false;
  const autoApprovalCheckboxId = normalizedMethod
    ? `auto-approve-${normalizedMethod.toLowerCase()}`
    : undefined;

  useEffect(() => {
    if (
      !pendingFunction ||
      !normalizedMethod ||
      !isHttpMethod ||
      pendingFunctionStatus !== 'awaiting' ||
      isExecutingFunction ||
      pendingFunctionAction !== 'none' ||
      !autoApprovedMethods.includes(normalizedMethod) ||
      functionError
    ) {
      return;
    }

    (async () => {
      try {
        await handleFunctionAction('approve');
      } catch (error) {
        console.error('Failed to auto-approve function call', error);
      }
    })();
  }, [
    pendingFunction,
    normalizedMethod,
    isHttpMethod,
    pendingFunctionStatus,
    isExecutingFunction,
    pendingFunctionAction,
    autoApprovedMethods,
    functionError,
    handleFunctionAction,
  ]);

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
      : autoApprovalEnabledForMethod && isHttpMethod
        ? `Auto-approval enabled for ${method} requests.`
        : 'Review and approve when you are ready.';

  return (
    <div className="chat-container">
      <div
        ref={chatScrollRef}
        className="chats"
        onScroll={handleChatScroll}
      >
        <div className="mb-auto w-full">
          {!displayMessages.length && !incomingMessage ? (
            <div className="m-auto justify-center flex items-center text-center" style={{ minHeight: '300px' }}>
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
          ) : (
            <>
              {displayMessages.map((message, index) => (
                <Message
                  key={message._id ?? message.tool_call_id ?? `msg-${index}`}
                  messageId={message._id}
                  role={resolveDisplayMessageRole(message as DisplayChatMessage)}
                  content={message.content ?? ''}
                  clientUrl={clientUrl}
                  reasoning={message.reasoning}
                  functionCallMeta={message.functionCallMeta}
                  status={message.status}
                  statusDetail={message.statusDetail}
                  onRetry={
                    canModifyHistory &&
                    resolveDisplayMessageRole(message as DisplayChatMessage) === 'user'
                      ? () => handleRetryFromMessage(index)
                      : undefined
                  }
                  onEdit={
                    canModifyHistory &&
                    resolveDisplayMessageRole(message as DisplayChatMessage) === 'user'
                      ? () => handleEditMessage(index)
                      : undefined
                  }
                />
              ))}
              {!!incomingMessage && (
                <Message
                  role="bot"
                  isFunction={isFunction}
                  content={incomingMessage}
                  reasoning={fullReasoning ?? undefined}
                  showStreamingCursor={generatingResponse && !isFunction}
                />
              )}
              {pendingFunction && (
                <div className="function-approval-wrapper">
                  <Image
                    className="chat-img"
                    src="/avatar-purple-no-shadow.svg"
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
                    {previewText && (
                      <p className="function-approval-preview">{previewText}</p>
                    )}
                    {(pendingFunction.metadata.description || assistantPlanText || pendingFunction.metadata.playbooks?.length || pendingArgumentEntries.length > 0) && (
                      <details className="function-approval-details">
                        <summary>View details</summary>
                        {pendingFunction.metadata.description && (
                          <p className="function-approval-description">
                            {pendingFunction.metadata.description}
                          </p>
                        )}
                        {assistantPlanText ? (
                          <div className="function-approval-reasoning">
                            <span className="function-arg-key">Plan</span>
                            {assistantPlanItems.length ? (
                              <ol className="function-approval-plan">
                                {assistantPlanItems.map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ol>
                            ) : (
                              <p>{assistantPlanText}</p>
                            )}
                          </div>
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
                      </details>
                    )}
                    {functionError && (
                      <div className="function-approval-error">{functionError}</div>
                    )}
                    {isHttpMethod && normalizedMethod && autoApprovalCheckboxId ? (
                      <div className="function-approval-preferences">
                        <div className="function-approval-preference-toggle">
                          <Switch
                            id={autoApprovalCheckboxId}
                            checked={autoApprovalEnabledForMethod}
                            onCheckedChange={(checked) =>
                              handleAutoApprovePreferenceChange(normalizedMethod, checked)
                            }
                            label={`Auto-approve future ${normalizedMethod} requests`}
                          />
                        </div>
                      </div>
                    ) : null}
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
            </>
          )}
        </div>
      </div>

      <footer className="chat-footer">
        <div className="chat-footer__inner">
          <div className="chat-footer__input">
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
            <div className="chat-input-wrapper">
              <textarea
                ref={inputRef}
                id={textareaId}
                value={messageText}
                onChange={handleInputChange}
                placeholder={generatingResponse ? 'Generating text...' : 'Send a message'}
                className="chat-input"
                onKeyDown={handleTextareaKeyDown}
                rows={3}
                disabled={generatingResponse || isFunction}
                aria-label="Message Alga"
                aria-busy={generatingResponse || isFunction}
                data-automation-id="chat-input"
              />
              {mentionQuery !== null && (
                <ChatMentionPopup
                  ref={mentionPopupRef}
                  query={mentionQuery}
                  onSelect={handleMentionSelect}
                  onDismiss={() => setMentionQuery(null)}
                />
              )}
            </div>
            <p className="chat-input__hint">
              {isMultilineMode
                ? 'Multiline mode: Enter adds a new line. Ctrl+Enter or ⌘+Enter sends.'
                : 'Press Enter to send. Shift+Enter switches to multiline mode.'}
            </p>
            {editingMessageIndex !== null ? (
              <p className="chat-input__hint chat-input__hint--editing">
                Editing selected message. Sending will replace that message and regenerate the
                thread from there.
                <button
                  type="button"
                  className="chat-input__cancel-edit"
                  onClick={handleCancelEdit}
                >
                  Cancel edit
                </button>
              </p>
            ) : null}
          </div>

          <div className="chat-action-group">
            {canStop ? (
              <button
                onClick={handleStop}
                type="button"
                className="chat-action chat-action--stop"
              >
                STOP
              </button>
            ) : null}
            <button
              onClick={handleClick}
              type="submit"
              className="chat-action chat-action--send"
              disabled={generatingResponse || isFunction}
            >
              SEND
            </button>
          </div>
        </div>
      </footer>

      <Dialog
        isOpen={showValidationDialog}
        onClose={closeValidationDialog}
        title="Message Required"
        id="chat-empty-message-dialog"
        footer={(
          <div className="flex justify-end space-x-2">
            <Button
              id="chat-empty-message-dialog-ok"
              onClick={closeValidationDialog}
            >
              OK
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <p className="text-sm text-gray-700">{validationMessage}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Chat;
