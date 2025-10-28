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
  }[]>([]);
  const [fullMessage, setFullMessage] = useState('');
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
        },
      ]);
      setFullMessage('');
    }
  }, [generatingResponse, fullMessage, botMessageId]);

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
        const assistantContent: string = data.message?.content ?? '';
        await addAssistantMessageToPersistence(createdChatId ?? chatId, assistantContent);
        setConversation(data.nextMessages ?? [...conversationWithUser, { role: 'assistant', content: assistantContent }]);
        setFullMessage(assistantContent);
        setIncomingMessage('');
        setIsFunction(false);
        setGeneratingResponse(false);
        setPendingFunction(null);
      } else if (data.type === 'function_proposed') {
        setPendingFunction({
          metadata: data.function,
          assistantPreview: data.assistantPreview,
          functionCall: data.functionCall,
          nextMessages: data.nextMessages,
          chatId: createdChatId ?? chatId,
        });
        setConversation(data.nextMessages);
        setIncomingMessage(
          data.assistantPreview || 'I need your approval before running that.',
        );
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
    setIncomingMessage(
      action === 'approve'
        ? 'Executing the requested action...'
        : 'Okay, I will respond without calling that function.',
    );

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
        const assistantContent: string = data.message?.content ?? '';
        await addAssistantMessageToPersistence(
          pendingFunction.chatId ?? chatId,
          assistantContent,
        );

        setConversation(
          data.nextMessages ?? [
            ...pendingFunction.nextMessages,
            { role: 'assistant', content: assistantContent },
          ],
        );
        setFullMessage(assistantContent);
        setIncomingMessage('');
        setIsFunction(false);
        setGeneratingResponse(false);
        setPendingFunction(null);
      } else if (data.type === 'function_proposed') {
        setPendingFunction({
          metadata: data.function,
          assistantPreview: data.assistantPreview,
          functionCall: data.functionCall,
          nextMessages: data.nextMessages,
          chatId: pendingFunction.chatId ?? chatId,
        });
        setConversation(data.nextMessages);
        setIncomingMessage(
          data.assistantPreview || 'I need your approval before running that.',
        );
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
      setIncomingMessage('I was unable to complete that action.');
      setIsFunction(false);
      setGeneratingResponse(false);
    } finally {
      setIsExecutingFunction(false);
    }
  };

  const displayMessages = [...messages, ...newChatMessages].filter(
    (message) => message.role !== 'function',
  );

  const functionArgumentsPreview = (args: Record<string, unknown>) =>
    JSON.stringify(args, null, 2);

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
              />
            ))}
            {!!incomingMessage && (
              <Message role="bot" isFunction={isFunction} content={incomingMessage} />
            )}
          </div>
        </div>
      )}

      {pendingFunction && (
        <div className="function-approval-card">
          <h3 className="text-lg font-semibold mb-2">
            The assistant wants to call: {pendingFunction.metadata.displayName}
          </h3>
          {pendingFunction.metadata.description && (
            <p className="text-sm mb-2">{pendingFunction.metadata.description}</p>
          )}
          <div className="mb-2">
            <span className="font-semibold">Arguments:</span>
            <pre className="function-arguments">
{functionArgumentsPreview(pendingFunction.metadata.arguments)}
            </pre>
          </div>
          {pendingFunction.metadata.playbooks?.length ? (
            <div className="mb-2 text-sm">
              <span className="font-semibold">Related playbooks: </span>
              {pendingFunction.metadata.playbooks.join(', ')}
            </div>
          ) : null}
          {functionError && (
            <p className="text-sm text-red-500 mb-2">{functionError}</p>
          )}
          <div className="flex gap-2">
            <button
              className="approve-btn"
              onClick={() => handleFunctionAction('approve')}
              disabled={isExecutingFunction}
            >
              {isExecutingFunction ? 'Approving…' : 'Approve'}
            </button>
            <button
              className="deny-btn"
              onClick={() => handleFunctionAction('decline')}
              disabled={isExecutingFunction}
            >
              {isExecutingFunction ? 'Processing…' : 'Deny'}
            </button>
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
