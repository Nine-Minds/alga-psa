'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { PageState, UIComponent } from './types';

/**
 * Context value interface containing the page state and methods to manipulate it
 */
interface UIStateContextValue {
  /** Current state of the page including all registered components */
  pageState: PageState;
  
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
  pageState: {
    id: '',
    title: '',
    components: []
  },
  registerComponent: () => {},
  unregisterComponent: () => {},
  updateComponent: () => {}
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

/**
 * Provider component that manages the UI reflection state
 */
export function UIStateProvider({
  children,
  initialPageState
}: UIStateProviderProps) {
  const [pageState, setPageState] = useState<PageState>(initialPageState);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

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

  // Emit state updates to AI Backend Server
  useEffect(() => {
    if (isConnected && socketRef.current) {
      socketRef.current.emit('UI_STATE_UPDATE', pageState);
    }
  }, [pageState, isConnected]);

  // Send periodic updates every 5 seconds
  useEffect(() => {
    if (!socketRef.current?.connected) return;

    const interval = setInterval(() => {
      socketRef.current?.emit('UI_STATE_UPDATE', pageState);
    }, 5000);

    return () => clearInterval(interval);
  }, [socketRef.current, pageState]);

  /**
   * Add a new component to the page state
   */
  const registerComponent = useCallback((component: UIComponent) => {
    setPageState((prev) => {
      // If component has a parentId, add it as a child to that parent
      if (component.parentId) {
        return {
          ...prev,
          components: prev.components.map(comp => {
            if (comp.id === component.parentId) {
              return {
                ...comp,
                children: [...(comp.children || []), component]
              };
            }
            return comp;
          })
        };
      }
      
      // Otherwise add to root level components
      return {
        ...prev,
        components: [...prev.components, component]
      };
    });
  }, []);

  /**
   * Remove a component and its children from the page state
   */
  const unregisterComponent = useCallback((id: string) => {
    setPageState((prev) => {
      // Helper function to get all descendant IDs
      const getDescendantIds = (comp: UIComponent): string[] => {
        const childIds = comp.children?.map(child => child.id) || [];
        const descendantIds = comp.children?.flatMap(getDescendantIds) || [];
        return [...childIds, ...descendantIds];
      };

      // Find component and get all its descendants
      const componentToRemove = prev.components.find(comp => comp.id === id);
      const idsToRemove = componentToRemove ? 
        [id, ...getDescendantIds(componentToRemove)] : 
        [id];

      // Remove from parent's children if it exists
      const updatedComponents = prev.components.map(comp => {
        if (comp.children) {
          return {
            ...comp,
            children: comp.children.filter(child => !idsToRemove.includes(child.id))
          };
        }
        return comp;
      });

      // Remove from root level
      return {
        ...prev,
        components: updatedComponents.filter(comp => !idsToRemove.includes(comp.id))
      };
    });
  }, []);

  /**
   * Update an existing component's properties
   */
  const updateComponent = useCallback((id: string, partial: Partial<UIComponent>) => {
    setPageState((prev) => {
      // Helper function to update component in a tree
      const updateComponentInTree = (components: UIComponent[]): UIComponent[] => {
        return components.map(comp => {
          if (comp.id === id) {
            // Ensure type safety by checking component type
            if (comp.type !== partial.type && partial.type !== undefined) {
              console.warn(`Cannot change component type from ${comp.type} to ${partial.type}`);
              return comp;
            }

            // Type-safe spread
            return {
              ...comp,
              ...partial,
              type: comp.type, // Preserve the original type
              // Preserve children if not explicitly updated
              children: partial.children || comp.children
            } as UIComponent;
          }

          // Recursively update children
          if (comp.children) {
            return {
              ...comp,
              children: updateComponentInTree(comp.children)
            };
          }

          return comp;
        });
      };

      return {
        ...prev,
        components: updateComponentInTree(prev.components)
      };
    });
  }, []);

  const value = {
    pageState,
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
