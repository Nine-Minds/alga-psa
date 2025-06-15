'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { 
  DirectMessage, 
  MessageThread
} from 'server/src/interfaces/messaging.interfaces';
import { 
  getMessageThreadsAction, 
  getThreadMessagesAction,
  markThreadAsReadAction,
  getUnreadMessageCountAction,
  sendDirectMessageAction
} from 'server/src/lib/actions/messaging-actions/directMessageActions';

export function useDirectMessages() {
  const { data: session } = useSession();
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [unreadMessageCount, setUnreadMessageCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Load initial data
  useEffect(() => {
    if (session?.user) {
      loadInitialData();
    }
  }, [session]);

  const loadInitialData = async () => {
    try {
      setIsLoading(true);
      const [threadsResult, unreadCount] = await Promise.all([
        getMessageThreadsAction(1, 20),
        getUnreadMessageCountAction()
      ]);
      
      setThreads(threadsResult.threads);
      setUnreadMessageCount(unreadCount);
    } catch (error) {
      console.error('Failed to load message threads:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshThreads = useCallback(() => {
    loadInitialData();
  }, []);

  return {
    threads,
    unreadMessageCount,
    isLoading,
    refreshThreads,
  };
}

export function useDirectMessageThread(threadId: string) {
  const { data: session } = useSession();
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connected');

  // Load persisted messages from database
  useEffect(() => {
    if (threadId && session?.user) {
      loadThreadMessages();
    }
  }, [threadId, session]);

  const loadThreadMessages = async () => {
    try {
      const messages = await getThreadMessagesAction(threadId);
      setMessages(messages);
      
      // Mark thread as read when opening
      await markThreadAsReadAction(threadId);
    } catch (error) {
      console.error('Failed to load thread messages:', error);
    }
  };

  const sendMessage = useCallback(async (messageContent: string) => {
    if (!session?.user) return;

    // Optimistically add message to UI
    const tempMessage: DirectMessage = {
      direct_message_id: `temp-${Date.now()}`,
      tenant: '',
      sender_id: session.user.id,
      recipient_id: '', // Will be filled by server
      thread_id: threadId,
      message: messageContent,
      created_at: new Date(),
    };

    setMessages(prev => [...prev, tempMessage]);

    try {
      // Find recipient from existing messages
      const otherParticipant = messages.find(m => 
        m.sender_id !== session.user.id ? m.sender_id : m.recipient_id
      );
      
      if (otherParticipant) {
        await sendDirectMessageAction({
          recipient_id: otherParticipant.sender_id === session.user.id ? 
                      otherParticipant.recipient_id : otherParticipant.sender_id,
          message: messageContent,
          thread_id: threadId,
        });
      }
      
      // Refresh messages to get the actual persisted message
      setTimeout(() => loadThreadMessages(), 500);
    } catch (error) {
      console.error('Failed to persist message:', error);
      // Remove optimistic message on error
      setMessages(prev => prev.filter(m => m.direct_message_id !== tempMessage.direct_message_id));
    }
  }, [session, threadId, messages]);

  const setTyping = useCallback((isTyping: boolean) => {
    // TODO: Implement typing indicators without Hocuspocus
  }, []);

  return {
    messages,
    typingUsers: [],
    connectionStatus,
    sendMessage,
    setTyping,
    refreshMessages: loadThreadMessages,
  };
}