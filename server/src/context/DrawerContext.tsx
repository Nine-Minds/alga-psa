'use client';

import Drawer from "server/src/components/ui/Drawer";
import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback, useReducer } from 'react';
import { Activity, ActivityType } from "server/src/interfaces/activity.interfaces";
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from "server/src/components/ui/Button";

// Define the drawer history entry type
interface DrawerHistoryEntry {
  id: string;
  type: 'list' | 'detail' | 'form' | 'custom';
  activityType?: ActivityType;
  activityId?: string;
  title: string;
  content: ReactNode;
  onMount?: () => Promise<void>;
  metadata?: Record<string, any>;
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
  openDrawer: (content: ReactNode, onMount?: () => Promise<void>) => void;
  replaceDrawer: (content: ReactNode, onMount?: () => Promise<void>) => void;
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
  | { type: 'OPEN_DRAWER'; payload: { content: ReactNode; onMount?: () => Promise<void> } }
  | { type: 'REPLACE_DRAWER'; payload: { content: ReactNode; onMount?: () => Promise<void> } }
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
      const { content, onMount } = action.payload;
      const newEntry: DrawerHistoryEntry = {
        id: `drawer-${Date.now()}`,
        type: 'custom',
        title: 'Drawer',
        content,
        onMount,
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
      const { content, onMount } = action.payload;
      const newEntry: DrawerHistoryEntry = {
        id: `drawer-${Date.now()}`,
        type: 'custom',
        title: 'Drawer',
        content,
        onMount,
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
  const openDrawer = useCallback((content: ReactNode, onMount?: () => Promise<void>) => {
    dispatch({ type: 'OPEN_DRAWER', payload: { content, onMount } });
  }, []);

  const replaceDrawer = useCallback((content: ReactNode, onMount?: () => Promise<void>) => {
    dispatch({ type: 'REPLACE_DRAWER', payload: { content, onMount } });
  }, []);

  const closeDrawer = useCallback(() => {
    dispatch({ type: 'CLOSE_DRAWER' });
  }, []);

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
    <DrawerContext.Provider value={{
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
      >
        {currentEntry && (
          <div className="flex flex-col h-full">
            <div className="flex items-center justify-between mb-6 border-b pb-4">
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
                <h2 className="text-xl font-semibold">{currentEntry.title}</h2>
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
                {/* Always show the close button for better UX */}
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
            <div className="flex-1 overflow-auto">
              <DrawerContent
                content={currentEntry.content}
                onMount={currentEntry.onMount}
              />
            </div>
          </div>
        )}
      </Drawer>
    </DrawerContext.Provider>
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
