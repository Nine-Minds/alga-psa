'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { PageState, UIComponent } from './types';
// import { create } from 'jsondiffpatch';

// Create a jsondiffpatch instance
// const jsondiffpatch = create();

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

/**
 * Provider component that manages the UI reflection state
 */
export function UIStateProvider({ children, initialPageState }: {
  children: React.ReactNode;
  initialPageState: PageState;
}) {
  const [pageState, setPageState] = useState<PageState>(initialPageState);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const timerRef = useRef<number>();

  // Initialize and manage Socket.IO connection
  useEffect(() => {
    const initializeSocket = () => {
      if (socketRef.current?.connected) {
        return; // Reuse existing connection
      }

      if (!socketRef.current && reconnectAttemptsRef.current < maxReconnectAttempts) {
        socketRef.current = io('http://localhost:4000', {
          transports: ['websocket'],
          reconnection: true,
          reconnectionDelay: Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 5000), // Exponential backoff
          reconnectionDelayMax: 5000,
          reconnectionAttempts: maxReconnectAttempts
        });

        const socket = socketRef.current;

        socket.on('connect', () => {
          console.log('Connected to AI Backend Server');
          setIsConnected(true);
          reconnectAttemptsRef.current = 0;
        });

        socket.on('connect_error', (error) => {
          console.error('Socket.IO connection error:', error);
          reconnectAttemptsRef.current++;
          setIsConnected(false);
        });

        socket.on('disconnect', () => {
          console.log('Disconnected from AI Backend Server');
          setIsConnected(false);
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

  useEffect(() => {
    if (!(socketRef.current?.connected)) return;
    socketRef.current?.emit('UI_STATE_UPDATE', pageState);
  
  }, [pageState]);

  // Send initial UI state update when socket connection changes
  useEffect(() => {
    if (!isConnected) return;
    socketRef.current?.emit('UI_STATE_UPDATE', pageState);
  }, [isConnected, pageState]);

  // Keep a single reference to the dictionary of all components
  const componentDictRef = useRef<ComponentDict>({});
  // Track the next available ordinal for deterministic ordering
  const nextOrdinalRef = useRef(0);

  /**
   * Registers or updates a component in the dictionary,
   * then rebuilds the entire tree.
   */
  const registerComponent = useCallback((component: UIComponent) => {
    setPageState((prev) => {
      const dict = { ...componentDictRef.current };
      const existing = dict[component.id];

      if (!existing) {
        // New component: assign an ordinal for deterministic ordering
        dict[component.id] = {
          ...component,
          ordinal: nextOrdinalRef.current,
        };
        nextOrdinalRef.current++;
      } else {
        // Existing component: preserve its ordinal
        dict[component.id] = {
          ...existing,
          ...component,
          ordinal: existing.ordinal,
        };
      }

      // Commit the updated dict
      componentDictRef.current = dict;

      // Rebuild the root array from the dictionary
      const newRoot = rebuildTreeFromDictionary(dict);

      const nextState = {
        ...prev,
        components: newRoot
      }

      // use jsondiffpatch to compare the current state with the next state
      // and only update the state if there are any changes
      // const patch = jsondiffpatch.diff(prev, nextState);
      // console.log('Patch:', JSON.stringify(patch, null, 2));

      return nextState;
    });
  }, []);

  /**
   * Unregister a component entirely (remove it from dictionary & from the tree).
   * Also removes its descendants, if desired.
   */
  const unregisterComponent = useCallback((id: string) => {
    setPageState((prev) => {
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

      return {
        ...prev,
        components: newRoot
      };
    });
  }, []);

  /**
   * Update a component's metadata by partial fields.
   */
  const updateComponent = useCallback((id: string, partial: Partial<UIComponent>) => {
    setPageState((prev) => {
      const dict = { ...componentDictRef.current };
      const existing = dict[id];
      if (!existing) {
        // If the component doesn't exist yet, we might choose to create it
        // or just ignore. For now, let's ignore.
        return prev;
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
      return {
        ...prev,
        components: newRoot
      };
    });
  }, []);

  // Provide context
  const value = {
    registerComponent,
    unregisterComponent,
    updateComponent
  };

  return (
    <UIStateContext.Provider value={value}>
      {children}
    </UIStateContext.Provider>
  );
}

/** Example DFS function to gather IDs of all descendants (including the parent itself). */
function getAllDescendants(dict: ComponentDict, id: string): string[] {
  const result: string[] = [];
  const stack = [id];
  
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (!dict[current]) continue;
    
    result.push(current);
    // Add children to stack
    const childIds = dict[current].children?.map((c): string => c.id) || [];
    stack.push(...childIds);
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
