'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { DirectMessage as DirectMessageType } from 'server/src/interfaces/messaging.interfaces';
import { useDirectMessageThread } from 'server/src/lib/hooks/useDirectMessages';
import { Button } from 'server/src/components/ui/Button';
import { TextArea } from 'server/src/components/ui/TextArea';
import UserAvatar from 'server/src/components/ui/UserAvatar';
import { Send, ArrowLeft } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export function DirectMessage() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const threadId = params?.threadId as string;
  const [messageInput, setMessageInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    typingUsers,
    connectionStatus,
    sendMessage,
    setTyping,
    refreshMessages,
  } = useDirectMessageThread(threadId);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle typing indicators
  useEffect(() => {
    if (messageInput) {
      if (!isTyping) {
        setIsTyping(true);
        setTyping(true);
      }
    } else {
      if (isTyping) {
        setIsTyping(false);
        setTyping(false);
      }
    }
  }, [messageInput, isTyping, setTyping]);

  const handleSendMessage = async () => {
    if (!messageInput.trim()) return;

    const message = messageInput.trim();
    setMessageInput('');
    setIsTyping(false);
    setTyping(false);

    try {
      await sendMessage(message);
    } catch (error) {
      console.error('Failed to send message:', error);
      // Restore message on error
      setMessageInput(message);
    }
  };


  const formatMessageTime = (date: Date) => {
    const now = new Date();
    const messageDate = new Date(date);
    
    // If message is from today, show time only
    if (messageDate.toDateString() === now.toDateString()) {
      return format(messageDate, 'HH:mm');
    }
    
    // If message is from this week, show day and time
    const daysDiff = Math.floor((now.getTime() - messageDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff < 7) {
      return format(messageDate, 'EEE HH:mm');
    }
    
    // Otherwise show full date
    return format(messageDate, 'MMM d, HH:mm');
  };

  const groupedMessages = messages.reduce((groups: Array<{
    sender_id: string;
    messages: DirectMessageType[];
    timestamp: Date;
  }>, message) => {
    const lastGroup = groups[groups.length - 1];
    const messageTime = new Date(message.created_at);
    
    // Group messages from same sender within 5 minutes
    if (
      lastGroup &&
      lastGroup.sender_id === message.sender_id &&
      messageTime.getTime() - lastGroup.timestamp.getTime() < 5 * 60 * 1000
    ) {
      lastGroup.messages.push(message);
    } else {
      groups.push({
        sender_id: message.sender_id,
        messages: [message],
        timestamp: messageTime,
      });
    }
    
    return groups;
  }, []);

  if (!threadId) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">Select a conversation to start messaging</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <Button
            id="back-button"
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="p-2"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            <UserAvatar 
              userId="other-user"
              userName="Team Member"
              avatarUrl={null}
              size="sm" 
            />
            <div>
              <h3 className="font-semibold">Team Member</h3>
              <p className="text-xs text-gray-500">
                {connectionStatus === 'connected' ? 'Online' : 'Offline'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {groupedMessages.map((group, groupIndex) => {
          const isCurrentUser = group.sender_id === session?.user?.id;
          
          return (
            <div
              key={groupIndex}
              className={`flex ${isCurrentUser ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex gap-2 max-w-xs lg:max-w-md ${isCurrentUser ? 'flex-row-reverse' : 'flex-row'}`}>
                {!isCurrentUser && (
                  <UserAvatar 
                    userId={group.sender_id}
                    userName="Team Member"
                    avatarUrl={null}
                    size="sm"
                    className="mt-auto"
                  />
                )}
                
                <div className="space-y-1">
                  {group.messages.map((message) => (
                    <div
                      key={message.direct_message_id}
                      className={`px-3 py-2 rounded-lg ${
                        isCurrentUser
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      <p className="text-sm whitespace-pre-wrap">{message.message}</p>
                    </div>
                  ))}
                  
                  <p className={`text-xs text-gray-500 ${isCurrentUser ? 'text-right' : 'text-left'}`}>
                    {formatMessageTime(group.timestamp)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}

        {/* Typing indicators - placeholder for future implementation */}
        {false && (
          <div className="flex justify-start">
            <div className="flex gap-2 max-w-xs">
              <UserAvatar 
                userId="typing-user"
                userName="Team Member"
                avatarUrl={null}
                size="sm" 
              />
              <div className="bg-gray-100 px-3 py-2 rounded-lg">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <div className="p-4 border-t border-gray-200">
        <div className="flex gap-2">
          <TextArea
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 resize-none"
            style={{ minHeight: '40px', maxHeight: '120px' }}
          />
          <Button
            id="send-message-button"
            onClick={handleSendMessage}
            disabled={!messageInput.trim() || connectionStatus !== 'connected'}
            className="px-3"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        
        {connectionStatus !== 'connected' && (
          <p className="text-xs text-red-500 mt-2">
            Reconnecting... Messages may be delayed.
          </p>
        )}
      </div>
    </div>
  );
}