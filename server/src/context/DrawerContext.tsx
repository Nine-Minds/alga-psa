'use client';

import Drawer from "@alga-psa/ui/components/Drawer";
import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback, useReducer } from 'react';
import { Activity, ActivityType } from "server/src/interfaces/activity.interfaces";
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from "@alga-psa/ui/components/Button";

// Define the drawer history entry type
interface DrawerHistoryEntry {
  id: string;
  type: 'list' | 'detail' | 'form' | 'custom';
  activityType?: ActivityType;
  activityId?: string;
  title: string;
  content: ReactNode;
  onMount?: () => Promise<void>;
  onClose?: () => void;
  metadata?: Record<string, any>;
  width?: string;
}

interface DrawerContentProps {
  content: ReactNode;
  onMount?: () => Promise<void>;
  title?: string;
  showBackButton?: boolean;
  showForwardButton?: boolean;
  onBack?: () => void;
  onForward?: () => void;
}

interface DrawerContextType {
  // Original methods
  openDrawer: (content: ReactNode, onMount?: () => Promise<void>, onClose?: () => void, width?: string) => void;
  replaceDrawer: (content: ReactNode, onMount?: () => Promise<void>, width?: string) => void;
  closeDrawer: () => void;
  goBack: () => void;
  
  // Enhanced methods for activities
  openListDrawer: (
    activityType: ActivityType,
    title: string,
    content: ReactNode,
    onMount?: () => Promise<void>,
    metadata?: Record<string, any>
  ) => void;
  
  openDetailDrawer: (
    activity: Activity,
    content: ReactNode,
    title?: string,
    onMount?: () => Promise<void>
  ) => void;
  
  openFormDrawer: (
    activity: Activity,
    formId: string,
    content: ReactNode,
    title?: string,
    onMount?: () => Promise<void>
  ) => void;
  
  goForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  currentEntry: DrawerHistoryEntry | null;
  history: DrawerHistoryEntry[];
}

// Define the drawer actions
type DrawerAction =
  | { type: 'OPEN_DRAWER'; payload: { content: ReactNode; onMount?: () => Promise<void>; onClose?: () => void; width?: string } }
  | { type: 'REPLACE_DRAWER'; payload: { content: ReactNode; onMount?: () => Promise<void>; width?: string } }
  | { type: 'OPEN_LIST_DRAWER'; payload: { activityType: ActivityType; title: string; content: ReactNode; onMount?: () => Promise<void>; metadata?: Record<string, any> } }
  | { type: 'OPEN_DETAIL_DRAWER'; payload: { activity: Activity; content: ReactNode; title?: string; onMount?: () => Promise<void> } }
  | { type: 'OPEN_FORM_DRAWER'; payload: { activity: Activity; formId: string; content: ReactNode; title?: string; onMount?: () => Promise<void> } }
  | { type: 'CLOSE_DRAWER' }
  | { type: 'GO_BACK' }
  | { type: 'GO_FORWARD' };

// Define the drawer state
interface DrawerState {
  isOpen: boolean;
  history: DrawerHistoryEntry[];
  currentIndex: number;
}

// Initial state
const initialState: DrawerState = {
  isOpen: false,
  history: [],
  currentIndex: -1,
};

// Drawer reducer
function drawerReducer(state: DrawerState, action: DrawerAction): DrawerState {
  switch (action.type) {
    case 'OPEN_DRAWER': {
      const { content, onMount, onClose, width } = action.payload;
      const newEntry: DrawerHistoryEntry = {
        id: `drawer-${Date.now()}`,
        type: 'custom',
        title: '',
        content,
        onMount,
        onClose,
        width,
      };
      
      // If we're not at the end of the history, truncate it
      const newHistory = state.currentIndex < state.history.length - 1
        ? state.history.slice(0, state.currentIndex + 1)
        : [...state.history];
      
      return {
        isOpen: true,
        history: [...newHistory, newEntry],
        currentIndex: newHistory.length,
      };
    }
    
    case 'REPLACE_DRAWER': {
      const { content, onMount, width } = action.payload;
      const newEntry: DrawerHistoryEntry = {
        id: `drawer-${Date.now()}`,
        type: 'custom',
        title: '',
        content,
        onMount,
        width,
      };
      
      return {
        isOpen: true,
        history: [newEntry],
        currentIndex: 0,
      };
    }
    
    case 'OPEN_LIST_DRAWER': {
      const { activityType, title, content, onMount, metadata } = action.payload;
      const newEntry: DrawerHistoryEntry = {
        id: `list-${activityType}-${Date.now()}`,
        type: 'list',
        activityType,
        title,
        content,
        onMount,
        metadata,
      };
      
      // If we're not at the end of the history, truncate it
      const newHistory = state.currentIndex < state.history.length - 1
        ? state.history.slice(0, state.currentIndex + 1)
        : [...state.history];
      
      return {
        isOpen: true,
        history: [...newHistory, newEntry],
        currentIndex: newHistory.length,
      };
    }
    
    case 'OPEN_DETAIL_DRAWER': {
      const { activity, content, title, onMount } = action.payload;
      const newEntry: DrawerHistoryEntry = {
        id: `detail-${activity.type}-${activity.id}`,
        type: 'detail',
        activityType: activity.type,
        activityId: activity.id,
        title: title || activity.title,
        content,
        onMount,
        metadata: { activity },
      };
      
      // If we're not at the end of the history, truncate it
      const newHistory = state.currentIndex < state.history.length - 1
        ? state.history.slice(0, state.currentIndex + 1)
        : [...state.history];
      
      return {
        isOpen: true,
        history: [...newHistory, newEntry],
        currentIndex: newHistory.length,
      };
    }
    
    case 'OPEN_FORM_DRAWER': {
      const { activity, formId, content, title, onMount } = action.payload;
      const newEntry: DrawerHistoryEntry = {
        id: `form-${activity.type}-${activity.id}-${formId}`,
        type: 'form',
        activityType: activity.type,
        activityId: activity.id,
        title: title || `${activity.title} - Form`,
        content,
        onMount,
        metadata: { activity, formId },
      };
      
      // If we're not at the end of the history, truncate it
      const newHistory = state.currentIndex < state.history.length - 1
        ? state.history.slice(0, state.currentIndex + 1)
        : [...state.history];
      
      return {
        isOpen: true,
        history: [...newHistory, newEntry],
        currentIndex: newHistory.length,
      };
    }
    
    case 'CLOSE_DRAWER':
      return {
        isOpen: false,
        history: [],
        currentIndex: -1,
      };
    
    case 'GO_BACK':
      if (state.currentIndex > 0) {
        return {
          ...state,
          currentIndex: state.currentIndex - 1,
        };
      }
      return state;
    
    case 'GO_FORWARD':
      if (state.currentIndex < state.history.length - 1) {
        return {
          ...state,
          currentIndex: state.currentIndex + 1,
        };
      }
      return state;
    
    default:
      return state;
  }
}

const DrawerContext = createContext<DrawerContextType | undefined>(undefined);

export const DrawerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(drawerReducer, initialState);
  
  // Compute derived state
  const canGoBack = state.currentIndex > 0;
  const canGoForward = state.currentIndex < state.history.length - 1;
  const currentEntry = state.currentIndex >= 0 ? state.history[state.currentIndex] : null;
  
  // Original methods (for backward compatibility)
  const openDrawer = useCallback((content: ReactNode, onMount?: () => Promise<void>, onClose?: () => void, width?: string) => {
    dispatch({ type: 'OPEN_DRAWER', payload: { content, onMount, onClose, width } });
  }, []);

  const replaceDrawer = useCallback((content: ReactNode, onMount?: () => Promise<void>, width?: string) => {
    dispatch({ type: 'REPLACE_DRAWER', payload: { content, onMount, width } });
  }, []);

  const closeDrawer = useCallback(() => {
    // Call onClose callback for the current entry before closing
    if (currentEntry?.onClose) {
      currentEntry.onClose();
    }
    dispatch({ type: 'CLOSE_DRAWER' });
  }, [currentEntry]);

  const goBack = useCallback(() => {
    dispatch({ type: 'GO_BACK' });
  }, []);
  
  // Enhanced methods for activities
  const openListDrawer = useCallback((
    activityType: ActivityType,
    title: string,
    content: ReactNode,
    onMount?: () => Promise<void>,
    metadata?: Record<string, any>
  ) => {
    dispatch({
      type: 'OPEN_LIST_DRAWER',
      payload: { activityType, title, content, onMount, metadata }
    });
  }, []);
  
  const openDetailDrawer = useCallback((
    activity: Activity,
    content: ReactNode,
    title?: string,
    onMount?: () => Promise<void>
  ) => {
    dispatch({
      type: 'OPEN_DETAIL_DRAWER',
      payload: { activity, content, title, onMount }
    });
  }, []);
  
  const openFormDrawer = useCallback((
    activity: Activity,
    formId: string,
    content: ReactNode,
    title?: string,
    onMount?: () => Promise<void>
  ) => {
    dispatch({
      type: 'OPEN_FORM_DRAWER',
      payload: { activity, formId, content, title, onMount }
    });
  }, []);
  
  const goForward = useCallback(() => {
    dispatch({ type: 'GO_FORWARD' });
  }, []);
  
  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (state.isOpen) {
        if (event.key === 'Escape') {
          dispatch({ type: 'CLOSE_DRAWER' });
        } else if (event.altKey && event.key === 'ArrowLeft' && canGoBack) {
          dispatch({ type: 'GO_BACK' });
        } else if (event.altKey && event.key === 'ArrowRight' && canGoForward) {
          dispatch({ type: 'GO_FORWARD' });
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.isOpen, canGoBack, canGoForward]);

  return (
    <DrawerContext value={{
      openDrawer,
      replaceDrawer,
      closeDrawer,
      goBack,
      openListDrawer,
      openDetailDrawer,
      openFormDrawer,
      goForward,
      canGoBack,
      canGoForward,
      currentEntry,
      history: state.history
    }}>
      {children}
      <Drawer
        isOpen={state.isOpen}
        onClose={closeDrawer}
        isInDrawer={state.history.length > 1}
        hideCloseButton={true}
        drawerVariant="nested"
        width={currentEntry?.width}
      >
        {currentEntry && (
          <div className="flex flex-col h-full relative">
            {/* Show full header if there's a title or navigation buttons */}
            {(currentEntry.title || canGoBack || canGoForward) ? (
              <div className="flex items-center justify-between mb-4 border-b pb-3">
                <div className="flex items-center">
                  {canGoBack && (
                    <Button
                      id="drawer-back-button"
                      variant="ghost"
                      size="sm"
                      onClick={goBack}
                      className="mr-2"
                      aria-label="Go back"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                  )}
                  {currentEntry.title && <h2 className="text-xl font-semibold">{currentEntry.title}</h2>}
                </div>
                <div className="flex items-center">
                  {canGoForward && (
                    <Button
                      id="drawer-forward-button"
                      variant="ghost"
                      size="sm"
                      onClick={goForward}
                      className="mr-2"
                      aria-label="Go forward"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    id="drawer-close-button"
                    variant="ghost"
                    size="sm"
                    onClick={closeDrawer}
                    aria-label="Close drawer"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              /* Minimal header with just close button - takes less vertical space */
              <div className="flex justify-end">
                <Button
                  id="drawer-close-button"
                  variant="ghost"
                  size="sm"
                  onClick={closeDrawer}
                  aria-label="Close drawer"
                  className="hover:bg-gray-100"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
            <div className="flex-1 overflow-auto">
              <DrawerContent
                content={currentEntry.content}
                onMount={currentEntry.onMount}
              />
            </div>
          </div>
        )}
      </Drawer>
    </DrawerContext>
  );
};

const DrawerContent: React.FC<DrawerContentProps> = ({ content, onMount }) => {
  const [isLoading, setIsLoading] = useState(!!onMount);

  React.useEffect(() => {
    if (onMount) {
      onMount().then(() => setIsLoading(false));
    }
  }, [onMount]);

  if (isLoading) {
    return <div className="flex justify-center items-center p-8">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
    </div>;
  }

  return <>{content}</>;
};

export const useDrawer = () => {
  const context = useContext(DrawerContext);
  if (context === undefined) {
    throw new Error('useDrawer must be used within a DrawerProvider');
  }
  return context;
};
