import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { v4 as uuid } from 'uuid';

import { Message } from "../../components/message/Message";
import { IChat } from "../../interfaces/chat.interface";
import { createNewChatAction, addMessageToChatAction } from '../../lib/chat-actions/chatActions';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { ChatModelInterface, ChatMessage } from '../../interfaces/ChatModelInterface';
import { HfInference } from '@huggingface/inference';

import "../../components/chat/chat.css";

type ChatProps = {
  clientUrl: string,
  accountId: string,
  messages: any[],
  userRole: string,
  selectedAccount: string,
  handleSelectAccount: any,
  auth_token: string,
  setChatTitle: any,
  isTitleLocked: boolean,
  onUserInput: () => void,
  hf: HfInference;
  functions?: any[]; // Keep the functions prop for passing to the API
};

export const Chat: React.FC<ChatProps> = ({
  clientUrl,
  accountId,
  messages,
  userRole,
  selectedAccount,
  handleSelectAccount,
  auth_token,
  setChatTitle,
  isTitleLocked,
  onUserInput,
  hf,
  functions = []
}) => {
  const [messageText, setMessageText] = useState('');
  const [incomingMessage, setIncomingMessage] = useState('');
  const [generatingResponse, setGeneratingResponse] = useState(false);
  const [isFunction, setIsFunction] = useState(false);
  const router = useRouter();
  const [newChatMessages, setNewChatMessages] = useState<{ _id: any; role: string; content: string; }[]>([]);
  const [fullMessage, setFullMessage] = useState('');
  const [chatId, setChatId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userMessageId, setUserMessageId] = useState<string | null>(null);
  const [botMessageId, setBotMessageId] = useState<string | null>(null);
  const controller = useRef(new AbortController());
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      const user = await getCurrentUser();
      setUserId(user?.user_id || '');
    };

    fetchUser();
  }, []);

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
      setNewChatMessages(prev => [...prev, {
        _id: botMessageId,
        role: "bot",
        content: fullMessage,
      }])
      setFullMessage('');
    }
  }, [generatingResponse, fullMessage, botMessageId]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setMessageText(value);
    if (onUserInput) {
      onUserInput();
    }
  };

  const sendMessage = () => {
    const trimmedMessage = messageText.trim();
    if (trimmedMessage.length === 0) {
      alert("Please enter a message");
      if (inputRef.current) {
        inputRef.current.focus();
      }
      return;
    }

    handleSend();

    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleEnter = async (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleClick = () => {
    sendMessage();
  };

  const handleStop = async () => {
    setGeneratingResponse(false);
    setIsFunction(false);
    try {
      controller.current.abort();
    } catch (error) {
      console.error(error);
    }
  }

  const handleSend = async () => {
    setGeneratingResponse(true);
    setIncomingMessage('');

    // Create new chat if needed
    let createdChatId: string | null = null;
    if (chatId == null) {
      try {
        const conversationInfo: Omit<IChat, 'tenant'> = {
          user_id: userId!,
          title_text: messageText.trim(),
          title_is_locked: false
        }
        const data = await createNewChatAction(conversationInfo);
        if (!data) {
          throw new Error('Failed to create new chat');
        }

        setChatId(data._id || null);
        createdChatId = data._id || null;

        // Save user message for new chat
        if (data._id) {
          const messageInfo = {
            chat_id: createdChatId!,
            chat_role: "user",
            content: messageText.trim(),
            thumb: null,
            feedback: null
          }
          const data = await addMessageToChatAction(messageInfo);
          setUserMessageId(data._id || null);
        }
      } catch (error) {
        console.error(error);
        return;
      }
    } else {
      // Save user message for existing chat
      try {
        const messageInfo = {
          chat_id: chatId,
          chat_role: "user",
          content: messageText.trim(),
          thumb: null,
          feedback: null
        }
        const data = await addMessageToChatAction(messageInfo);
        setUserMessageId(data._id || null);
      } catch (error) {
        console.error(error);
        return;
      }
    }

    // Update UI with user message
    setNewChatMessages(prev => [
      ...prev,
      {
        _id: userMessageId,
        role: "user",
        content: messageText,
      }
    ]);

    setMessageText('');

    // Prepare all messages for the API call
    let allMessages = [...messages, ...newChatMessages, {
      chat_id: chatId,
      role: "user",
      content: messageText.trim(),
    }];


    const loadingTimeout = setTimeout(() => {
      if (!controller.current.signal.aborted) {
        setIsFunction(true);
        setIncomingMessage('Loading...');
      }
    }, 1000);
  
    controller.current = new AbortController();
  
    try {
      const response = await fetch('/api/chat/stream/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'openrouter',
          inputs: allMessages,
          functions: functions,
          options: {
            max_new_tokens: 500,
            temperature: 0.7,
            top_p: 0.95,
            repetition_penalty: 1.2,
          },
          meta: {
            authorization: auth_token
          }
        }),
        signal: controller.current.signal
      });
  
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
  
      // Clear loading message and timeout as soon as we get a response
      clearTimeout(loadingTimeout);
      setIncomingMessage('');
      setIsFunction(false);
  
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
  
      if (!reader) {
        throw new Error('No reader available');
      }
  
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
  
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
  
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'function_execution') {
                setIsFunction(true);
                setIncomingMessage(data.content);
                continue;
              }
  
              if (data.type === 'error') {
                setIncomingMessage(data.content);
                continue;
              }
  
              if (data.type === 'text') {
                setIsFunction(false);
                setIncomingMessage(prev => prev + data.content);
                fullResponse += data.content;
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e);
            }
          }
        }
      }

      // Save bot response to chat
      if (fullResponse) {
        try {
          const messageInfo = {
            chat_id: createdChatId ?? chatId,
            chat_role: "bot",
            content: fullResponse,
            thumb: null,
            feedback: null,
          };
          const data = await addMessageToChatAction(messageInfo);
          setBotMessageId(data._id || null);
        } catch (error) {
          console.error(error);
        }

        setIncomingMessage("");
        setGeneratingResponse(false);
        setFullMessage(fullResponse);
      }

    } catch (error) {
      clearTimeout(loadingTimeout); // Clear timeout on error
      console.error('Error in chat stream:', error);
      setGeneratingResponse(false);
      setIsFunction(false);
      setIncomingMessage("An error occurred while generating the response.");
    }
  };
  

  const allMessages = [...messages, ...newChatMessages];

  return (
    <div className="chat-container">
      {!allMessages.length && !incomingMessage &&
        <div className="m-auto justify-center flex items-center text-center h-64">
          <div className="initial-alga">
            <Image
              className="mb-6"
              src="/avatar-purple-no-shadow.svg"
              alt="Alga"
              width={150}
              height={150} />
            <h1 className="mt-6 text-2xl mx-1">I am Alga! Your favorite AI assistant. Ask me a question.</h1>
          </div>
        </div>
      }
      {!!allMessages.length &&
        <div className="chats">
          <div className="mb-auto w-full">
            {allMessages.map((message) => (
              <Message
                key={message._id}
                messageId={message._id}
                role={message.role}
                content={message.content}
                clientUrl={clientUrl}
              />
            ))}
            {!!incomingMessage && (
              <Message
                role="bot"
                isFunction={isFunction}
                content={incomingMessage} />
            )}
          </div>
        </div>
      }
      <footer className="chat-footer">
        <div className="input-container">
          <div className="input">
            <textarea
              ref={inputRef}
              value={messageText}
              onChange={handleInputChange}
              placeholder={generatingResponse ? "Generating text..." : "Send a message"}
              className="w-full resize-none rounded-md p-2 text-black"
              onKeyDown={handleEnter}
              rows={1}
              disabled={generatingResponse || isFunction}
            />
          </div>

          <button
            onClick={generatingResponse ? handleStop : handleClick}
            type="submit"
            className={generatingResponse ? `stop-btn rounded-md px-4 py-2 text-white` : `send-btn rounded-md px-4 py-2 text-white`}
          >
            {generatingResponse ? "STOP" : "SEND"}
          </button>
        </div>
      </footer>
    </div>
  );
};
