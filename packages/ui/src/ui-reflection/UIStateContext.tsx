'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { PageState, UIComponent } from './types';
import { createUIStateRegistry, UIStateRegistry } from './uiStateRegistry';

/**
 * Context value interface containing the page state and methods to manipulate it
 */
interface UIStateContextValue {
  /** Current state of the page including all registered components */
  // pageState: PageState;

  /** Register a new component in the page state */
  registerComponent: (component: UIComponent) => void;

  /** Remove a component from the page state */
  unregisterComponent: (id: string) => void;

  /** Update an existing component's properties */
  updateComponent: (id: string, partial: Partial<UIComponent>) => void;

  /**
   * Synchronously rebuild the tree and publish `window.__UI_STATE__` if any
   * registry mutations are pending. Normally publishing is coalesced to one
   * per microtask; use this in tests/automation that read state synchronously.
   */
  flushUIState: () => void;
}

/**
 * Default context value with no-op functions
 */
const defaultContextValue: UIStateContextValue = {
  // pageState: {
  //   id: '',
  //   title: '',
  //   components: []
  // },
  registerComponent: () => { },
  unregisterComponent: () => { },
  updateComponent: () => { },
  flushUIState: () => { }
};

/**
 * React context for the UI reflection system
 */
const UIStateContext = createContext<UIStateContextValue>(defaultContextValue);

/**
 * Props for the UIStateProvider component
 */
interface UIStateProviderProps {
  /** Child components that will have access to the UI state context */
  children: React.ReactNode;

  /** Initial state for the page */
  initialPageState: PageState;
}

let pageState: PageState | null = null;
let activeRegistry: UIStateRegistry | null = null;

function setPageState(state: PageState) {
  pageState = state;
  // Expose page state to window for browser automation access
  if (typeof window !== 'undefined') {
    (window as any).__UI_STATE__ = state;
  }
}

/**
 * Module-level synchronous flush for code outside React (tests, automation
 * helpers): publishes any pending registry mutations to `window.__UI_STATE__`
 * immediately. No-op when no UIStateProvider has mounted.
 */
export function flushUIState(): void {
  activeRegistry?.flush();
}

/**
 * Provider component that manages the UI reflection state
 */
export function UIStateProvider({ children, initialPageState }: {
  children: React.ReactNode;
  initialPageState: PageState;
}) {
  // const [pageState, setPageState] = useState<PageState>(initialPageState);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const timerRef = useRef<number | undefined>(undefined);

  // Initialize and manage Socket.IO connection
  useEffect(() => {
    const initializeSocket = () => {
      // Check if AI backend is enabled via environment variable
      const aiBackendEnabled = process.env.NEXT_PUBLIC_AI_BACKEND_ENABLED === 'true';

      if (!aiBackendEnabled) {
        console.log('🔌 [UI-STATE] AI Backend disabled - skipping Socket.IO connection');
        console.log('🔌 [UI-STATE] UI reflection system active: window.__UI_STATE__ available for test automation');
        return;
      }
      
      if (socketRef.current?.connected) {
        return; // Reuse existing connection
      }

      if (!socketRef.current && reconnectAttemptsRef.current < maxReconnectAttempts) {
        const aiBackendUrl = process.env.NEXT_PUBLIC_AI_BACKEND_URL || 'http://localhost:4000';
        socketRef.current = io(aiBackendUrl, {
          transports: ['websocket'],
          reconnection: true,
          reconnectionDelay: Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 5000), // Exponential backoff
          reconnectionDelayMax: 5000,
          reconnectionAttempts: maxReconnectAttempts
        });

        const socket = socketRef.current;

        socket.on('connect', () => {
          console.log('🔌 [UI-STATE] Connected to AI Backend Server (Socket ID:', socket.id, ')');
          setIsConnected(true);
          reconnectAttemptsRef.current = 0;
        });

        socket.on('connect_error', (error) => {
          console.error('❌ [UI-STATE] Socket.IO connection error:', error);
          console.error('❌ [UI-STATE] Connection attempts:', reconnectAttemptsRef.current);
          reconnectAttemptsRef.current++;
          setIsConnected(false);
        });

        socket.on('disconnect', (reason) => {
          console.log('🔌 [UI-STATE] Disconnected from AI Backend Server. Reason:', reason);
          setIsConnected(false);
        });

        // Add more detailed connection logging
        socket.on('error', (error) => {
          console.error('❌ [UI-STATE] Socket error:', error);
        });

        socket.io.on('error', (error) => {
          console.error('❌ [UI-STATE] Socket.IO engine error:', error);
        });

        socket.io.on('reconnect', (attemptNumber) => {
          console.log('🔄 [UI-STATE] Reconnected after', attemptNumber, 'attempts');
        });

        socket.io.on('reconnect_attempt', (attemptNumber) => {
          console.log('🔄 [UI-STATE] Reconnection attempt #', attemptNumber);
        });

        socket.io.on('reconnect_error', (error) => {
          console.error('❌ [UI-STATE] Reconnection error:', error);
        });

        socket.io.on('reconnect_failed', () => {
          console.error('❌ [UI-STATE] Reconnection failed completely');
        });
      }
    };

    initializeSocket();

    // Cleanup function
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
        setIsConnected(false);
        reconnectAttemptsRef.current = 0;
      }
    };
  }, []); // Empty dependency array since we manage connection internally

  // Send UI state updates on changes (debounced) + periodic sync
  // Only send if socket is connected (AI backend is enabled)
  useEffect(() => {
    if (!socketRef.current?.connected) {
      return;
    }

    // Debounce immediate updates by 100ms to handle React StrictMode double-mounting
    const timeoutId = setTimeout(() => {
      socketRef.current?.emit('UI_STATE_UPDATE', pageState);
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [pageState]);

  // Periodic UI state sync every 3 seconds to ensure server stays in sync
  useEffect(() => {
    const sendPeriodicUpdate = () => {
      if (socketRef.current?.connected && pageState) {
        socketRef.current.emit('UI_STATE_UPDATE', pageState);
      }
    };

    // Send periodic updates every 3 seconds
    const intervalId = setInterval(sendPeriodicUpdate, 3000);
    
    // Send immediate update when this effect starts
    sendPeriodicUpdate();
    
    return () => clearInterval(intervalId);
  }, [isConnected]); // Re-establish interval when connection changes

  // Send initial UI state update when socket connection changes
  useEffect(() => {
    if (!isConnected) {
      // UI state is still available on window.__UI_STATE__ for test automation
      // even when AI backend is not connected
      return;
    }
    socketRef.current?.emit('UI_STATE_UPDATE', pageState);
  }, [isConnected, pageState]);

  // Registry owns the component dictionary; it applies mutations immediately
  // and coalesces tree rebuild + publish to once per microtask (or flushUIState()).
  const registryRef = useRef<UIStateRegistry | null>(null);
  if (!registryRef.current) {
    registryRef.current = createUIStateRegistry({ onPublish: setPageState });
  }
  const registry = registryRef.current;
  activeRegistry = registry;

  const registerComponent = useCallback((component: UIComponent | undefined) => {
    registry.register(component);
  }, [registry]);

  const unregisterComponent = useCallback((id: string) => {
    registry.unregister(id);
  }, [registry]);

  const updateComponent = useCallback((id: string, partial: Partial<UIComponent>) => {
    registry.update(id, partial);
  }, [registry]);

  const flushUIState = useCallback(() => {
    registry.flush();
  }, [registry]);

  // Provide context — memoize to avoid re-rendering all consumers on every state change
  const value = React.useMemo(() => ({
    registerComponent,
    unregisterComponent,
    updateComponent,
    flushUIState
  }), [registerComponent, unregisterComponent, updateComponent, flushUIState]);

  return (
    <UIStateContext value={value}>
      {children}
    </UIStateContext>
  );
}

/**
 * Custom hook to access the UI state context
 * @throws {Error} If used outside of a UIStateProvider
 */
export function useUIState() {
  const context = useContext(UIStateContext);
  
  if (context === defaultContextValue) {
    throw new Error('useUIState must be used within a UIStateProvider');
  }
  
  return context;
}

/**
 * Export the context for advanced use cases
 */
export { UIStateContext };
