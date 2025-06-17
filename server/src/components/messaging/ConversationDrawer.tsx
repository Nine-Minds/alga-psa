'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { TextArea } from 'server/src/components/ui/TextArea';
import UserAvatar from 'server/src/components/ui/UserAvatar';
import { Send } from 'lucide-react';
import { format } from 'date-fns';
import { useSession } from 'next-auth/react';
import { DirectMessage as DirectMessageType } from 'server/src/interfaces/messaging.interfaces';
import { useDirectMessageThread } from 'server/src/lib/hooks/useDirectMessages';
import { getUserWithRoles } from 'server/src/lib/actions/user-actions/userActions';

interface ConversationDrawerContentProps {
  threadId: string;
  participantId?: string;
}

export function ConversationDrawerContent({ threadId, participantId }: ConversationDrawerContentProps) {
  const { data: session } = useSession();
  const [messageInput, setMessageInput] = useState('');
  const [participantInfo, setParticipantInfo] = useState<any>(null);
  const [userCache, setUserCache] = useState<Map<string, any>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    connectionStatus,
    sendMessage,
  } = useDirectMessageThread(threadId);

  // Load user information helper
  const loadUserInfo = useCallback(async (userId: string) => {
    if (userCache.has(userId)) {
      return userCache.get(userId);
    }
    
    try {
      const user = await getUserWithRoles(userId);
      if (user) {
        const userInfo = {
          user_id: user.user_id,
          full_name: `${user.first_name} ${user.last_name}`.trim() || 'Team Member',
          avatar_url: user.avatarUrl || null, // Now this should have the actual avatar URL
        };
        setUserCache(prev => new Map(prev.set(userId, userInfo)));
        return userInfo;
      }
    } catch (error) {
      console.error('Failed to load user info:', error);
    }
    
    const fallbackInfo = {
      user_id: userId,
      full_name: 'Team Member',
      avatar_url: null,
    };
    setUserCache(prev => new Map(prev.set(userId, fallbackInfo)));
    return fallbackInfo;
  }, []); // Remove userCache dependency to prevent infinite loops

  // Load participant information
  useEffect(() => {
    if (participantId) {
      loadUserInfo(participantId).then(setParticipantInfo);
    }
  }, [participantId, loadUserInfo]);

  // Load user info for all message senders
  useEffect(() => {
    const loadMessageSenderInfo = async () => {
      const uniqueSenderIds = [...new Set(messages.map(m => m.sender_id))];
      const unloadedIds = uniqueSenderIds.filter(id => !userCache.has(id));
      
      if (unloadedIds.length > 0) {
        // Load users in parallel for better performance
        await Promise.all(unloadedIds.map(id => loadUserInfo(id)));
      }
    };
    
    if (messages.length > 0) {
      loadMessageSenderInfo();
    }
  }, [messages, loadUserInfo]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async () => {
    if (!messageInput.trim()) return;

    const message = messageInput.trim();
    setMessageInput('');

    try {
      await sendMessage(message);
    } catch (error) {
      console.error('Failed to send message:', error);
      // Restore message on error
      setMessageInput(message);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-gray-200 bg-white">
        <UserAvatar 
          userId={participantInfo?.user_id || 'unknown'}
          userName={participantInfo?.full_name || 'Team Member'}
          avatarUrl={participantInfo?.avatar_url}
          size="sm" 
        />
        <div>
          <h3 className="font-semibold">{participantInfo?.full_name || 'Team Member'}</h3>
          <p className="text-xs text-gray-500">
            {/* TODO: Implement real online status */}
            Last seen recently
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
          {groupedMessages.length === 0 ? (
            <div className="text-center text-gray-500 mt-8">
              <p>No messages yet</p>
              <p className="text-sm">Start the conversation!</p>
            </div>
          ) : (
            groupedMessages.map((group, groupIndex) => {
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
                        userName={userCache.get(group.sender_id)?.full_name || participantInfo?.full_name || 'Team Member'}
                        avatarUrl={userCache.get(group.sender_id)?.avatar_url || participantInfo?.avatar_url}
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
                              : 'bg-white text-gray-900 border border-gray-200'
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
            })
          )}
          
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <div className="p-4 border-t border-gray-200 bg-white">
          <div className="flex gap-2">
            <TextArea
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              rows={1}
              className="flex-1 resize-none"
              style={{ minHeight: '40px', maxHeight: '120px' }}
            />
            <Button
              id="send-message-drawer"
              onClick={handleSendMessage}
              disabled={!messageInput.trim()}
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