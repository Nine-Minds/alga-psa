'use client';

import Drawer from '../components/Drawer';
import { guardActiveDismiss } from '../components/DismissGuard';
import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, ReactNode, useCallback, useReducer } from 'react';
import type { Activity, ActivityType } from '@alga-psa/types';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '../components/Button';
import { useCatalogShortcut, useShortcutScope } from '../keyboard-shortcuts';
import { useTranslation } from '../lib/i18n/client';

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
  /**
   * True while a DrawerOutlet is mounted under this provider. Routes without an outlet would
   * swallow openDrawer silently; callers that must show UI (e.g. the header stopwatch Stop) check
   * this and fall back explicitly.
   */
  hasOutlet?: () => boolean;
  /** Called by DrawerOutlet on mount; returns the unregister function. */
  registerOutlet?: () => () => void;
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

type DrawerHistoryAction = Extract<DrawerAction, { type: 'CLOSE_DRAWER' | 'GO_BACK' | 'GO_FORWARD' }>;
type DrawerOpenAction = Exclude<DrawerAction, DrawerHistoryAction>;

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
        title: title || '',
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

// Provider scopes retain the contexts in which their content may render. They
// share one history; changing owners starts a new history instead of replaying
// entries beneath a different set of feature providers.
interface DrawerScope {
  parent: DrawerScope | null;
  children: Set<DrawerScope>;
  outlets: number;
  mounted: boolean;
}

interface OwnedDrawerState {
  owner: DrawerScope | null;
  drawer: DrawerState;
}

type OwnedDrawerAction =
  | { type: 'OPEN'; action: DrawerOpenAction; owner: DrawerScope }
  | { type: 'HISTORY'; action: DrawerHistoryAction; scope?: DrawerScope }
  | { type: 'REMOVE_SCOPE'; scope: DrawerScope };

const initialOwnedState: OwnedDrawerState = { owner: null, drawer: initialState };

function isWithinScope(owner: DrawerScope | null, scope: DrawerScope): boolean {
  for (let current = owner; current; current = current.parent) {
    if (current === scope) return true;
  }
  return false;
}

function ownedDrawerReducer(state: OwnedDrawerState, event: OwnedDrawerAction): OwnedDrawerState {
  if (event.type === 'REMOVE_SCOPE') {
    return isWithinScope(state.owner, event.scope) ? initialOwnedState : state;
  }
  if (event.type === 'HISTORY' && event.scope && !isWithinScope(state.owner, event.scope)) return state;
  const owner = event.type === 'OPEN' ? event.owner : state.owner;
  const base = owner === state.owner ? state.drawer : initialState;
  const drawer = drawerReducer(base, event.action);
  return { owner: drawer.isOpen ? owner : null, drawer };
}

// Prefer the most recently mounted descendant with an outlet. Live membership
// avoids restoring a stale delegate when overlapping routes leave out of order.
function findOutletScope(scope: DrawerScope): DrawerScope | null {
  if (!scope.mounted) return null;
  for (const child of Array.from(scope.children).reverse()) {
    const candidate = findOutletScope(child);
    if (candidate) return candidate;
  }
  return scope.outlets > 0 ? scope : null;
}

interface DrawerStore {
  state: OwnedDrawerState;
  dispatch: React.Dispatch<OwnedDrawerAction>;
  closeDrawer: (scope?: DrawerScope) => void;
  goBack: (scope?: DrawerScope) => void;
  goForward: (scope?: DrawerScope) => void;
}

const DrawerStoreContext = createContext<DrawerStore | null>(null);
const DrawerScopeContext = createContext<DrawerScope | null>(null);
const DrawerContext = createContext<DrawerContextType | undefined>(undefined);

function DrawerStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(ownedDrawerReducer, initialOwnedState);
  const stateRef = useRef(state);
  useLayoutEffect(() => { stateRef.current = state; }, [state]);
  const updateHistory = useCallback((action: DrawerHistoryAction, scope?: DrawerScope) => {
    const current = stateRef.current;
    if (scope && !scope.mounted) return;
    if (action.type === 'CLOSE_DRAWER' && (!scope || isWithinScope(current.owner, scope))) {
      current.drawer.history[current.drawer.currentIndex]?.onClose?.();
    }
    dispatch({ type: 'HISTORY', action, scope });
  }, []);
  const closeDrawer = useCallback((scope?: DrawerScope) => updateHistory({ type: 'CLOSE_DRAWER' }, scope), [updateHistory]);
  const goBack = useCallback((scope?: DrawerScope) => updateHistory({ type: 'GO_BACK' }, scope), [updateHistory]);
  const goForward = useCallback((scope?: DrawerScope) => updateHistory({ type: 'GO_FORWARD' }, scope), [updateHistory]);
  const { isOpen, currentIndex, history } = state.drawer;

  // Register keyboard commands once for the shared, visible history.
  useShortcutScope('panel', isOpen);
  const guardedClose = useCallback(() => guardActiveDismiss(closeDrawer), [closeDrawer]);
  const guardedBack = useCallback(() => guardActiveDismiss(goBack), [goBack]);
  const guardedForward = useCallback(() => guardActiveDismiss(goForward), [goForward]);
  useCatalogShortcut('panel.close', guardedClose, { enabled: isOpen });
  useCatalogShortcut('drawer.historyBack', guardedBack, { enabled: isOpen && currentIndex > 0 });
  useCatalogShortcut('drawer.historyForward', guardedForward, { enabled: isOpen && currentIndex < history.length - 1 });

  return (
    <DrawerStoreContext value={{ state, dispatch, closeDrawer, goBack, goForward }}>
      <DrawerScopeProvider>{children}</DrawerScopeProvider>
    </DrawerStoreContext>
  );
}

function DrawerScopeProvider({ children }: { children: ReactNode }) {
  const store = useContext(DrawerStoreContext)!;
  const parent = useContext(DrawerScopeContext);
  const [scope] = useState<DrawerScope>(() => ({ parent, children: new Set(), outlets: 0, mounted: true }));
  const { state, dispatch, closeDrawer: closeOwnedDrawer, goBack: backOwnedDrawer, goForward: forwardOwnedDrawer } = store;

  useLayoutEffect(() => {
    scope.mounted = true;
    parent?.children.add(scope);
    return () => {
      scope.mounted = false;
      parent?.children.delete(scope);
      dispatch({ type: 'REMOVE_SCOPE', scope });
    };
  }, [dispatch, parent, scope]);

  const registerOutlet = useCallback(() => {
    scope.outlets += 1;
    return () => { scope.outlets -= 1; };
  }, [scope]);
  const hasOutlet = useCallback(() => findOutletScope(scope) !== null, [scope]);
  // Async work may retain commands after its route has left. Such callbacks
  // must not mutate the next route's drawer through the shared store.
  const closeDrawer = useCallback(() => {
    closeOwnedDrawer(scope);
  }, [scope, closeOwnedDrawer]);
  const goBack = useCallback(() => {
    backOwnedDrawer(scope);
  }, [scope, backOwnedDrawer]);
  const goForward = useCallback(() => {
    forwardOwnedDrawer(scope);
  }, [scope, forwardOwnedDrawer]);
  const open = useCallback((action: DrawerOpenAction) => {
    if (scope.mounted) {
      dispatch({ type: 'OPEN', owner: findOutletScope(scope) ?? scope, action });
    }
  }, [dispatch, scope]);
  const openDrawer = useCallback<DrawerContextType['openDrawer']>((content, onMount, onClose, width) => {
    open({ type: 'OPEN_DRAWER', payload: { content, onMount, onClose, width } });
  }, [open]);
  const replaceDrawer = useCallback<DrawerContextType['replaceDrawer']>((content, onMount, width) => {
    open({ type: 'REPLACE_DRAWER', payload: { content, onMount, width } });
  }, [open]);
  const openListDrawer = useCallback<DrawerContextType['openListDrawer']>((activityType, title, content, onMount, metadata) => {
    open({ type: 'OPEN_LIST_DRAWER', payload: { activityType, title, content, onMount, metadata } });
  }, [open]);
  const openDetailDrawer = useCallback<DrawerContextType['openDetailDrawer']>((activity, content, title, onMount) => {
    open({ type: 'OPEN_DETAIL_DRAWER', payload: { activity, content, title, onMount } });
  }, [open]);
  const openFormDrawer = useCallback<DrawerContextType['openFormDrawer']>((activity, formId, content, title, onMount) => {
    open({ type: 'OPEN_FORM_DRAWER', payload: { activity, formId, content, title, onMount } });
  }, [open]);
  const { history, currentIndex } = state.drawer;

  return (
    <DrawerScopeContext value={scope}>
      <DrawerContext value={{
        openDrawer, replaceDrawer, closeDrawer, goBack, goForward,
        openListDrawer, openDetailDrawer, openFormDrawer, hasOutlet, registerOutlet,
        canGoBack: currentIndex > 0,
        canGoForward: currentIndex < history.length - 1,
        currentEntry: history[currentIndex] ?? null,
        history,
      }}>
        {children}
      </DrawerContext>
    </DrawerScopeContext>
  );
}

export const DrawerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const store = useContext(DrawerStoreContext);
  return store
    ? <DrawerScopeProvider>{children}</DrawerScopeProvider>
    : <DrawerStoreProvider>{children}</DrawerStoreProvider>;
};

/**
 * Renders the managed drawer UI for DrawerProvider.
 * Place this inside all context providers so drawer content inherits the full provider tree.
 */
export const DrawerOutlet: React.FC = () => {
  const { t } = useTranslation('common');
  const { closeDrawer, goBack, goForward, canGoBack, canGoForward, currentEntry, history, registerOutlet } = useDrawer();
  const store = useContext(DrawerStoreContext)!;
  const scope = useContext(DrawerScopeContext);
  useLayoutEffect(() => registerOutlet?.(), [registerOutlet]);
  // Every outlet observes the same history, but only its owning scope may
  // materialize the content and supply its feature contexts.
  if (store.state.owner !== scope) return null;
  const isOpen = history.length > 0 && currentEntry !== null;
  const title = currentEntry?.type === 'form' && !currentEntry.title
    ? t('drawer.formTitle', { title: currentEntry.metadata?.activity.title, defaultValue: `${currentEntry.metadata?.activity.title} - Form` })
    : currentEntry?.title;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={closeDrawer}
      isInDrawer={history.length > 1}
      hideCloseButton={true}
      drawerVariant="nested"
      width={currentEntry?.width}
    >
      {currentEntry && (
        <div className="flex flex-col h-full relative">
          {(title || canGoBack || canGoForward) ? (
            <div className="flex items-center justify-between mb-4 border-b pb-3">
              <div className="flex items-center">
                {canGoBack && (
                  <Button
                    id="drawer-back-button"
                    variant="ghost"
                    size="sm"
                    onClick={() => guardActiveDismiss(goBack)}
                    className="mr-2"
                    aria-label={t('drawer.actions.goBack', { defaultValue: 'Go back' })}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                )}
                {title && <h2 className="text-xl font-semibold">{title}</h2>}
              </div>
              <div className="flex items-center">
                {canGoForward && (
                  <Button
                    id="drawer-forward-button"
                    variant="ghost"
                    size="sm"
                    onClick={() => guardActiveDismiss(goForward)}
                    className="mr-2"
                    aria-label={t('drawer.actions.goForward', { defaultValue: 'Go forward' })}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  id="drawer-close-button"
                  variant="ghost"
                  size="sm"
                  onClick={() => guardActiveDismiss(closeDrawer)}
                  aria-label={t('drawer.actions.close', { defaultValue: 'Close drawer' })}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end">
              <Button
                id="drawer-close-button"
                variant="ghost"
                size="sm"
                onClick={() => guardActiveDismiss(closeDrawer)}
                aria-label={t('drawer.actions.close', { defaultValue: 'Close drawer' })}
                className="hover:bg-gray-100 dark:hover:bg-[rgb(var(--color-border-100))]"
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
