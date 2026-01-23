'use client';

import React, { useEffect, useRef, useState, useCallback, useId } from 'react';
import Image from 'next/image';

import { Message, type FunctionCallMeta } from '../../components/message/Message';
import { IChat } from '../../interfaces/chat.interface';
import {
  createNewChatAction,
  addMessageToChatAction,
} from '../../lib/chat-actions/chatActions';
import { HfInference } from '@huggingface/inference';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';

import './chat.css';

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
  onChatIdChange?: (chatId: string | null) => void;
  autoApprovedHttpMethods?: string[];
};

const AUTO_APPROVED_METHODS_STORAGE_KEY = 'chat:autoApprovedHttpMethods';
const STANDARD_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const STANDARD_HTTP_METHOD_SET = new Set<string>(STANDARD_HTTP_METHODS);

const mapMessagesFromProps = (records: any[]): ChatCompletionMessage[] =>
  records.map((record: any) => ({
    role: record.chat_role === 'bot' ? 'assistant' : 'user',
    content: record.content ?? '',
    reasoning: record.reasoning ?? undefined,
  }));

type StreamEventPayload = { content?: unknown; done?: unknown };

async function readAssistantContentFromSse(response: Response): Promise<string> {
  if (!response.body) {
    throw new Error('Streaming response missing body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  const processEvent = (rawEvent: string) => {
    const lines = rawEvent.split('\n');
    for (const line of lines) {
      if (!line.startsWith('data:')) {
        continue;
      }
      const jsonText = line.slice('data:'.length).trim();
      if (!jsonText.length) {
        continue;
      }

      let payload: StreamEventPayload;
      try {
        payload = JSON.parse(jsonText) as StreamEventPayload;
      } catch {
        continue;
      }

      if (typeof payload.content === 'string') {
        content += payload.content;
      }
      if (payload.done === true) {
        return true;
      }
    }

    return false;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let boundaryIndex = buffer.indexOf('\n\n');
    while (boundaryIndex !== -1) {
      const rawEvent = buffer.slice(0, boundaryIndex);
      buffer = buffer.slice(boundaryIndex + 2);
      if (processEvent(rawEvent)) {
        return content;
      }
      boundaryIndex = buffer.indexOf('\n\n');
    }
  }

  if (buffer.length > 0) {
    processEvent(buffer);
  }

  return content;
}

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
  onChatIdChange,
  autoApprovedHttpMethods,
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
    }[]
  >([]);
  const [fullMessage, setFullMessage] = useState('');
  const [fullReasoning, setFullReasoning] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string | null>(initialChatId ?? null);
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
  const [autoApprovedMethods, setAutoApprovedMethods] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [showValidationDialog, setShowValidationDialog] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');
  const autoSendRef = useRef(false);
  const typingControllerRef = useRef<AbortController | null>(null);
  const messageOrderRef = useRef<number>(0);
  const streamingTextRef = useRef<string | null>(null);

  const resolveMessageId = (candidate?: string | null) =>
    candidate ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `msg-${Date.now()}-${Math.random()}`);

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
      typingControllerRef.current?.abort();
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
          _id: resolveMessageId(botMessageId),
          role: 'bot',
          content: fullMessage,
          reasoning: fullReasoning ?? undefined,
          functionCallMeta: undefined,
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

  const addAssistantMessageToPersistence = useCallback(async (
    chatIdentifier: string | null,
    content: string,
    messageOrder?: number,
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
        message_order: messageOrder,
      };
      const saved = await addMessageToChatAction(messageInfo);
      setBotMessageId(saved._id || null);
    } catch (error) {
      console.error('Failed to persist assistant message', error);
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
    typingControllerRef.current?.abort();
    if (streamingTextRef.current) {
      setIncomingMessage('');
      setFullMessage(streamingTextRef.current);
      streamingTextRef.current = null;
    }
    setGeneratingResponse(false);
    setIsFunction(false);
    setPendingFunction(null);
    setIsExecutingFunction(false);
  };

  const handleSend = useCallback(async (trimmedMessage: string) => {
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

    setNewChatMessages((prev) => [
      ...prev,
      {
        _id: resolveMessageId(userMessageId),
        role: 'user',
        content: trimmedMessage,
        functionCallMeta: undefined,
      },
    ]);

    setMessageText('');
    if (inputRef.current) {
      inputRef.current.style.height = '';
      requestAnimationFrame(autoResizeTextarea);
    }

    try {
      const response = await fetch('/api/chat/v1/completions/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: conversationWithUser,
        }),
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

      const finalAssistantContent = await readAssistantContentFromSse(response);

      const assistantOrder = messageOrderRef.current + 1;
      messageOrderRef.current = assistantOrder;
      await addAssistantMessageToPersistence(
        createdChatId ?? chatId,
        finalAssistantContent,
        assistantOrder,
      );

      setConversation([
        ...conversationWithUser,
        {
          role: 'assistant',
          content: finalAssistantContent,
        },
      ]);

      typingControllerRef.current?.abort();
      const controller = new AbortController();
      typingControllerRef.current = controller;

      setFullReasoning(null);
      setIsFunction(false);
      setIncomingMessage('');
      streamingTextRef.current = finalAssistantContent;

      const fullText = finalAssistantContent;
      const totalSteps = Math.max(12, Math.min(140, Math.ceil(fullText.length / 14)));
      const stepSize = Math.max(1, Math.ceil(fullText.length / totalSteps));

      if (fullText.length === 0) {
        setIncomingMessage('');
        setFullMessage('');
        setGeneratingResponse(false);
        streamingTextRef.current = null;
      } else {
        let revealed = 0;
        const streamStep = () => {
          if (controller.signal.aborted) {
            return;
          }

          revealed = Math.min(fullText.length, revealed + stepSize);
          const next = fullText.slice(0, revealed);
          setIncomingMessage(next);

          if (revealed >= fullText.length) {
            setIncomingMessage('');
            setFullMessage(fullText);
            setGeneratingResponse(false);
            streamingTextRef.current = null;
            return;
          }

          requestAnimationFrame(streamStep);
        };

        requestAnimationFrame(streamStep);
      }
      setPendingFunctionStatus('idle');
      setPendingFunctionAction('none');
      setPendingFunction(null);
    } catch (error) {
      console.error('Error generating completion', error);
      setIncomingMessage('An error occurred while generating the response.');
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
    void handleSend(prompt);
  }, [autoSendPrompt, handleSend]);

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

      const outcomeStatus: FunctionCallMeta['status'] =
        action === 'decline'
          ? 'declined'
          : data.type === 'assistant_message'
            ? 'success'
            : 'pending';
      appendFunctionCallMarker(pendingFunction, action, outcomeStatus);

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
        const assistantOrder = messageOrderRef.current + 1;
        messageOrderRef.current = assistantOrder;
        await addAssistantMessageToPersistence(
          pendingFunction.chatId ?? chatId,
          finalAssistantContent,
          assistantOrder,
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
      setIsExecutingFunction(false);
    }
  }, [pendingFunction, chatId, addAssistantMessageToPersistence]);

  const displayMessages = [...messages, ...newChatMessages].filter(
    (message) => message.role !== 'function',
  );

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
      <div className="chats">
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
                  role={message.role}
                  content={message.content}
                  clientUrl={clientUrl}
                  reasoning={message.reasoning}
                  functionCallMeta={message.functionCallMeta}
                />
              ))}
              {!!incomingMessage && (
                <Message role="bot" isFunction={isFunction} content={incomingMessage} />
              )}
            </>
          )}
        </div>
      </div>

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
                <p className="function-approval-preferences-help">
                  {autoApprovalEnabledForMethod
                    ? 'Future requests with this method will run automatically.'
                    : 'Enable to approve this HTTP method without prompts.'}
                </p>
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

      <footer className="chat-footer">
        <div className="chat-footer__inner">
          <div className="chat-footer__input">
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
            <p className="chat-input__hint">
              Press Ctrl+Enter or ⌘+Enter to send.
            </p>
          </div>

          <button
            onClick={generatingResponse ? handleStop : handleClick}
            type="submit"
            className={generatingResponse ? 'chat-action chat-action--stop' : 'chat-action chat-action--send'}
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
