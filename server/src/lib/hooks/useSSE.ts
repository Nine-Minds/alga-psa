'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';

interface SSEOptions {
  endpoint: string;
  onMessage?: (event: MessageEvent) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}

export function useSSE({
  endpoint,
  onMessage,
  onError,
  onOpen,
  reconnectDelay = 5000,
  maxReconnectAttempts = 5,
}: SSEOptions) {
  const { data: session } = useSession();
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const [connectionState, setConnectionState] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [lastEventId, setLastEventId] = useState<string | null>(null);

  const connect = useCallback(() => {
    if (!session?.user || eventSourceRef.current?.readyState === EventSource.OPEN) {
      return;
    }

    setConnectionState('connecting');

    // Build URL with last event ID for resumption
    const url = new URL(endpoint, window.location.origin);
    if (lastEventId) {
      url.searchParams.set('lastEventId', lastEventId);
    }

    const eventSource = new EventSource(url.toString(), {
      withCredentials: true,
    });

    // Connection opened
    eventSource.onopen = () => {
      console.log('SSE connection established');
      setConnectionState('open');
      reconnectAttemptsRef.current = 0;
      onOpen?.();
    };

    // Handle messages
    eventSource.onmessage = (event) => {
      if (event.lastEventId) {
        setLastEventId(event.lastEventId);
      }
      onMessage?.(event);
    };

    // Handle specific event types
    eventSource.addEventListener('notification', (event) => {
      if (event.lastEventId) {
        setLastEventId(event.lastEventId);
      }
      // Create a custom event object with the correct type
      const messageEvent = {
        type: 'notification',
        data: event.data,
        lastEventId: event.lastEventId,
        target: event.target,
        currentTarget: event.currentTarget,
        bubbles: false,
        cancelable: false,
        preventDefault: () => {},
        stopPropagation: () => {},
        stopImmediatePropagation: () => {}
      } as MessageEvent;
      onMessage?.(messageEvent);
    });

    eventSource.addEventListener('initial-notifications', (event) => {
      if (event.lastEventId) {
        setLastEventId(event.lastEventId);
      }
      const messageEvent = {
        type: 'initial-notifications',
        data: event.data,
        lastEventId: event.lastEventId,
        target: event.target,
        currentTarget: event.currentTarget,
        bubbles: false,
        cancelable: false,
        preventDefault: () => {},
        stopPropagation: () => {},
        stopImmediatePropagation: () => {}
      } as MessageEvent;
      onMessage?.(messageEvent);
    });

    eventSource.addEventListener('notification-read', (event) => {
      if (event.lastEventId) {
        setLastEventId(event.lastEventId);
      }
      const messageEvent = {
        type: 'notification-read',
        data: event.data,
        lastEventId: event.lastEventId,
        target: event.target,
        currentTarget: event.currentTarget,
        bubbles: false,
        cancelable: false,
        preventDefault: () => {},
        stopPropagation: () => {},
        stopImmediatePropagation: () => {}
      } as MessageEvent;
      onMessage?.(messageEvent);
    });

    eventSource.addEventListener('heartbeat', (event) => {
      // Heartbeat events, just for keeping connection alive
      console.debug('SSE heartbeat received');
    });

    eventSource.addEventListener('connected', (event) => {
      console.log('SSE connected event received');
      const messageEvent = {
        type: 'connected',
        data: event.data,
        lastEventId: event.lastEventId,
        target: event.target,
        currentTarget: event.currentTarget,
        bubbles: false,
        cancelable: false,
        preventDefault: () => {},
        stopPropagation: () => {},
        stopImmediatePropagation: () => {}
      } as MessageEvent;
      onMessage?.(messageEvent);
    });

    // Error handling
    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      setConnectionState('closed');
      onError?.(error);

      // Attempt reconnection
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current++;
        const delay = reconnectDelay * Math.pow(2, reconnectAttemptsRef.current - 1);
        
        console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
        
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, delay);
      } else {
        console.error('Max reconnection attempts reached');
      }

      eventSource.close();
    };

    eventSourceRef.current = eventSource;
  }, [session, endpoint, onMessage, onError, onOpen, lastEventId, reconnectDelay, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    
    setConnectionState('closed');
  }, []);

  useEffect(() => {
    if (session?.user) {
      connect();
    } else {
      // If no session, set to closed instead of connecting
      setConnectionState('closed');
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [session, connect, disconnect]);

  return {
    connectionState,
    reconnect: connect,
    disconnect,
  };
}