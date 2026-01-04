'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { PageState, UIComponent, DatePickerComponent } from './types';
import { create } from 'jsondiffpatch';

// Create a jsondiffpatch instance
const jsondiffpatch = create();

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
  updateComponent: () => { }
};

// Define a dictionary for all UI components keyed by ID
type ComponentDict = Record<string, UIComponent>;

/** 
 * Rebuild the entire tree from the component dictionary.
 * - Reset each component's `children` to []
 * - Attach each node to its parent if `parentId` is valid
 * - Otherwise, push it to top-level
 * - Sort children and root components by ordinal for deterministic ordering
 */
function rebuildTreeFromDictionary(dict: ComponentDict): UIComponent[] {
  // First, clear out all children arrays
  for (const key in dict) {
    dict[key].children = [];
  }

  const rootComponents: UIComponent[] = [];

  // Attach children to parents
  for (const key in dict) {
    const comp = dict[key];

    // If comp has a parent and that parent is in dict, link them
    if (comp.parentId && dict[comp.parentId]) {
      dict[comp.parentId].children!.push(comp);
    } else {
      // Otherwise, this is top-level
      rootComponents.push(comp);
    }
  }

  // Sort children of each node by ordinal
  for (const key in dict) {
    dict[key].children?.sort((a, b) => {
      const aOrd = a.ordinal ?? 0;
      const bOrd = b.ordinal ?? 0;
      return aOrd - bOrd;
    });
  }

  // Sort root components by ordinal
  rootComponents.sort((a, b) => {
    const aOrd = a.ordinal ?? 0;
    const bOrd = b.ordinal ?? 0;
    return aOrd - bOrd;
  });

  return rootComponents;
}

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
      // Still log state changes for debugging, even without AI backend
      console.log('📊 [UI-STATE] State updated:', pageState ? {
        id: pageState.id,
        title: pageState.title,
        componentCount: pageState.components?.length || 0
      } : 'null');
      return;
    }

    // Debounce immediate updates by 100ms to handle React StrictMode double-mounting
    const timeoutId = setTimeout(() => {
      console.log('📤 [UI-STATE] Sending immediate UI_STATE_UPDATE to automation server');
      console.log('📤 [UI-STATE] Page state:', pageState ? {
        id: pageState.id,
        title: pageState.title,
        componentCount: pageState.components?.length || 0
      } : 'null');
      socketRef.current?.emit('UI_STATE_UPDATE', pageState);
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [pageState]);

  // Periodic UI state sync every 3 seconds to ensure server stays in sync
  useEffect(() => {
    const sendPeriodicUpdate = () => {
      if (socketRef.current?.connected && pageState) {
        console.log('🔄 [UI-STATE] Sending periodic UI_STATE_UPDATE (sync)');
        console.log('🔄 [UI-STATE] Periodic state:', {
          id: pageState.id,
          title: pageState.title,
          componentCount: pageState.components?.length || 0
        });
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
    console.log('📤 [UI-STATE] Sending initial UI_STATE_UPDATE on connection');
    console.log('📤 [UI-STATE] Initial page state:', pageState ? {
      id: pageState.id,
      title: pageState.title,
      componentCount: pageState.components?.length || 0
    } : 'null');
    socketRef.current?.emit('UI_STATE_UPDATE', pageState);
  }, [isConnected, pageState]);

  // Keep a single reference to the dictionary of all components
  const componentDictRef = useRef<ComponentDict>({});
  // Track the next available ordinal for deterministic ordering
  const nextOrdinalRef = useRef(0);

  const setPageState = (state: PageState) => {
    pageState = state;
    // Expose page state to window for browser automation access
    if (typeof window !== 'undefined') {
      (window as any).__UI_STATE__ = state;
    }
  }

  /**
   * Registers or updates a component in the dictionary,
   * then rebuilds the entire tree.
   */
  const registerComponent = useCallback((component: UIComponent | undefined) => {
    if (!component) {
      console.log('Attempted to register undefined component');
      return;
    }

    // Don't skip registration if component already exists - instead update it
    const isExisting = !!componentDictRef.current[component.id];
    if (isExisting) {
      console.log(`🔄 [UI-STATE] Component with ID ${component.id} already exists. Updating registration.`);
    } else {
      console.log(`➕ [UI-STATE] Registering new component: ${component.id} (${component.type})`);
    }

    const dict = { ...componentDictRef.current };
    const existing = dict[component.id];

    // Set the ordinal based on whether this is a new or existing component
    const ordinal = !existing ? nextOrdinalRef.current : existing.ordinal;

    // Create the component entry
    dict[component.id] = {
      ...(existing || {}),
      ...component,
      ordinal
    } as UIComponent;

    // Increment ordinal for new components
    if (!existing) {
      nextOrdinalRef.current++;
    }

    // Commit the updated dict
    componentDictRef.current = dict;

    // Rebuild the root array from the dictionary
    const newRoot = rebuildTreeFromDictionary(dict);

    const nextState: PageState = {
      id: pageState?.id || 'page',
      title: pageState?.title || '',
      components: newRoot
    };

    // use jsondiffpatch to compare the current state with the next state
    // and only update if there are changes
    const patch = jsondiffpatch.diff(pageState, nextState);
    if (!patch) {
      console.log(`⚪ [UI-STATE] No changes detected for ${component.id}, skipping state update`);
      return;
    }

    console.log(`✅ [UI-STATE] State updated with component ${component.id}. Total components: ${nextState.components.length}`);
    setPageState(nextState);
  }, []);

  /**
   * Unregister a component entirely (remove it from dictionary & from the tree).
   * Also removes its descendants, if desired.
   */
  const unregisterComponent = useCallback((id: string) => {
    if (!componentDictRef.current[id]) {
      console.log(`➖ [UI-STATE] Component with ID ${id} does not exist. Skipping unregistration.`);
      return;
    }
    
    console.log(`➖ [UI-STATE] Unregistering component: ${id}`);

    // Make a copy of the dictionary
    const dict = { ...componentDictRef.current };

    // We can do a DFS or BFS in the dictionary to find all descendants
    const idsToRemove = getAllDescendants(dict, id);

    // Remove them all
    for (const removeId of idsToRemove) {
      delete dict[removeId];
    }

    // Commit changes
    componentDictRef.current = dict;
    const newRoot = rebuildTreeFromDictionary(dict);

    const nextState: PageState = {
      id: pageState?.id || 'page',
      title: pageState?.title || '',
      components: newRoot
    };

    setPageState(nextState);
  }, []);

  /**
   * Update a component's metadata by partial fields.
   */
  const updateComponent = useCallback((id: string, partial: Partial<UIComponent>) => {
    const dict = { ...componentDictRef.current };
    const existing = dict[id];

    if (!existing) {
      return;
    }
    
    // Merge partial update, but preserve type, children & ordinal
    dict[id] = {
      ...existing,
      ...partial,
      type: existing.type,
      children: existing.children,
      ordinal: existing.ordinal
    } as UIComponent;

    componentDictRef.current = dict;
    const newRoot = rebuildTreeFromDictionary(dict);
    var newPageState: PageState | null = {
      id: pageState?.id || 'page',
      title: pageState?.title || '',
      components: newRoot
    };

    setPageState(newPageState);
  }, []);

  // Provide context
  const value = {
    registerComponent,
    unregisterComponent,
    updateComponent
  };

  return (
    <UIStateContext value={value}>
      {children}
    </UIStateContext>
  );
}

/** Example DFS function to gather IDs of all descendants (including the parent itself). */
function getAllDescendants(dict: ComponentDict, id: string): string[] {
  const result: string[] = [];
  const stack = [id];
  const visited = new Set<string>();
  
  let maxIterations = 100;
  while (stack.length > 0 && maxIterations > 0) {
    maxIterations--;
    const current = stack.pop()!;
    
    // Skip if component doesn't exist in dictionary
    if (!dict[current]) continue;
    
    // Check for circular reference
    if (visited.has(current)) {
      // This can happen with complex UI structures and is handled gracefully
      // Only log in development mode to avoid cluttering production logs
      if (process.env.NODE_ENV === 'development') {
        console.debug(
          `Circular reference detected: Component ${current} has already been processed. ` +
          `Current path: ${Array.from(visited).join(' -> ')} -> ${current}`
        );
      }
      continue;
  }

    // Mark as visited and add to result
    visited.add(current);
    result.push(current);
    
    // Add children to stack
    const childIds = dict[current].children?.map((c): string => c.id) || [];
    stack.push(...childIds);
  }

  if (maxIterations <= 0 && stack.length > 0) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        'Maximum iterations exceeded while gathering descendants. ' +
        'This indicates either a very deep component tree or a circular reference. ' +
        `Processed components: ${Array.from(visited).join(' -> ')}`
      );
    }
}

  return result;
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
