'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { matchEvent } from './matcher';
import { parseBinding } from './parser';
import { normalizeDefaultBindings, ShortcutRegistry } from './registry';
import { DEFAULT_PLATFORM, useClientPlatform } from './platform';
import { createMemoryShortcutStorage } from './storage';
import type { BindingDescriptor, Platform, ShortcutAction, ShortcutScope, ShortcutStorage } from './types';

interface ScopeEntry {
  id: number;
  scope: ShortcutScope;
}

interface ActiveRegionEntry {
  id: number;
}

interface ShortcutConflict {
  binding: string;
  actionIds: readonly string[];
}

interface DispatchState {
  activeScopes: readonly ShortcutScope[];
  activeRegionCount: number;
  registeredActionIds: readonly string[];
}

interface KeyboardShortcutsContextValue {
  registerAction: (action: ShortcutAction) => () => void;
  pushScope: (scope: ShortcutScope) => () => void;
  registerActiveRegion: () => () => void;
  storage: ShortcutStorage;
  getState: () => DispatchState;
}

export interface KeyboardShortcutsProviderProps {
  children: ReactNode;
  platform?: Platform;
  routeKey?: string;
  disabledActionIds?: readonly string[];
  storage?: ShortcutStorage;
  onConflict?: (conflict: ShortcutConflict) => void;
}

export interface KeyboardShortcutRegistrySnapshot {
  getState: () => DispatchState;
}

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextValue | null>(null);

let nextEntryId = 1;

function isElementEditable(element: Element): boolean {
  const htmlElement = element as HTMLElement;
  const tagName = htmlElement.tagName.toLowerCase();

  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }

  if (htmlElement.isContentEditable) {
    return true;
  }

  if (htmlElement.closest('[contenteditable="true"]')) {
    return true;
  }

  const role = htmlElement.getAttribute('role');
  if (role === 'textbox' || role === 'combobox') {
    return true;
  }

  return Boolean(htmlElement.closest('[data-keyboard-shortcuts-editor-root="true"]'));
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && isElementEditable(target);
}

function requiresActiveRegion(action: ShortcutAction, descriptor: BindingDescriptor): boolean {
  if (action.id.startsWith('selection.')) {
    return true;
  }

  return (
    action.scope === 'page' &&
    descriptor.modifiers.length === 0 &&
    descriptor.token.kind === 'code' &&
    /^Key[A-Z]$/.test(descriptor.token.value)
  );
}

function scopeStackIndex(action: ShortcutAction, activeScopes: readonly ScopeEntry[]): number {
  if (action.scope === 'global') {
    return -1;
  }

  for (let index = activeScopes.length - 1; index >= 0; index -= 1) {
    if (activeScopes[index].scope === action.scope) {
      return index;
    }
  }

  return -1;
}

function isScopeEligible(action: ShortcutAction, activeScopes: readonly ScopeEntry[]): boolean {
  return action.scope === 'global' || activeScopes.some((entry) => entry.scope === action.scope);
}

export function KeyboardShortcutsProvider({
  children,
  platform,
  routeKey,
  disabledActionIds = [],
  storage,
  onConflict,
}: KeyboardShortcutsProviderProps) {
  const detectedPlatform = useClientPlatform(DEFAULT_PLATFORM);
  const effectivePlatform = platform ?? detectedPlatform;
  const registryRef = useRef(new ShortcutRegistry());
  const defaultStorageRef = useRef(createMemoryShortcutStorage());
  const activeScopesRef = useRef<ScopeEntry[]>([]);
  const activeRegionsRef = useRef<ActiveRegionEntry[]>([]);
  const platformRef = useRef(effectivePlatform);
  const disabledActionIdsRef = useRef<readonly string[]>(disabledActionIds);
  const onConflictRef = useRef(onConflict);
  const previousRouteKeyRef = useRef(routeKey);

  platformRef.current = effectivePlatform;
  disabledActionIdsRef.current = disabledActionIds;
  onConflictRef.current = onConflict;

  const registerAction = useCallback((action: ShortcutAction) => {
    return registryRef.current.add(action);
  }, []);

  const pushScope = useCallback((scope: ShortcutScope) => {
    const entry = { id: nextEntryId++, scope };
    activeScopesRef.current = [...activeScopesRef.current, entry];

    return () => {
      activeScopesRef.current = activeScopesRef.current.filter((candidate) => candidate.id !== entry.id);
    };
  }, []);

  const registerActiveRegion = useCallback(() => {
    const entry = { id: nextEntryId++ };
    activeRegionsRef.current = [...activeRegionsRef.current, entry];

    return () => {
      activeRegionsRef.current = activeRegionsRef.current.filter((candidate) => candidate.id !== entry.id);
    };
  }, []);

  const getState = useCallback<KeyboardShortcutsContextValue['getState']>(() => {
    return {
      activeScopes: activeScopesRef.current.map((entry) => entry.scope),
      activeRegionCount: activeRegionsRef.current.length,
      registeredActionIds: registryRef.current.list().map((action) => action.id),
    };
  }, []);

  useEffect(() => {
    if (previousRouteKeyRef.current !== routeKey) {
      activeScopesRef.current = [];
      activeRegionsRef.current = [];
      previousRouteKeyRef.current = routeKey;
    }
  }, [routeKey]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      const disabled = new Set(disabledActionIdsRef.current);
      const editableTarget = isEditableTarget(event.target);
      const candidates: Array<{
        action: ShortcutAction;
        binding: string;
        scopeIndex: number;
        priority: number;
      }> = [];

      for (const action of registryRef.current.list()) {
        if (action.enabled === false || disabled.has(action.id)) {
          continue;
        }

        if (!isScopeEligible(action, activeScopesRef.current)) {
          continue;
        }

        if (editableTarget && !action.allowInEditable) {
          continue;
        }

        const defaultBindings = normalizeDefaultBindings(action.defaultBindings)[platformRef.current];
        for (const binding of defaultBindings) {
          const parsed = parseBinding(binding);
          if (!parsed.ok) {
            continue;
          }

          if (!matchEvent(event, parsed.value, platformRef.current)) {
            continue;
          }

          if (requiresActiveRegion(action, parsed.value) && activeRegionsRef.current.length === 0) {
            continue;
          }

          candidates.push({
            action,
            binding,
            scopeIndex: scopeStackIndex(action, activeScopesRef.current),
            priority: action.priority ?? 0,
          });
        }
      }

      if (candidates.length === 0) {
        return;
      }

      const highestPriority = Math.max(...candidates.map((candidate) => candidate.priority));
      const priorityWinners = candidates.filter((candidate) => candidate.priority === highestPriority);
      const highestScopeIndex = Math.max(...priorityWinners.map((candidate) => candidate.scopeIndex));
      const scopeWinners = priorityWinners.filter((candidate) => candidate.scopeIndex === highestScopeIndex);
      const uniqueActionIds = Array.from(new Set(scopeWinners.map((candidate) => candidate.action.id)));

      if (uniqueActionIds.length !== 1) {
        onConflictRef.current?.({
          binding: scopeWinners[0]?.binding ?? '',
          actionIds: uniqueActionIds,
        });
        return;
      }

      const winner = scopeWinners[0];
      const result = winner.action.handler(event);
      if (result !== false) {
        event.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, []);

  const value = useMemo<KeyboardShortcutsContextValue>(
    () => ({
      registerAction,
      pushScope,
      registerActiveRegion,
      storage: storage ?? defaultStorageRef.current,
      getState,
    }),
    [getState, pushScope, registerAction, registerActiveRegion, storage],
  );

  return (
    <KeyboardShortcutsContext.Provider value={value}>
      {children}
    </KeyboardShortcutsContext.Provider>
  );
}

export function useKeyboardShortcutsContext(): KeyboardShortcutsContextValue {
  const context = useContext(KeyboardShortcutsContext);
  if (!context) {
    throw new Error('Keyboard shortcut hooks must be used inside KeyboardShortcutsProvider.');
  }

  return context;
}

export function useShortcutStorage(): ShortcutStorage {
  return useKeyboardShortcutsContext().storage;
}

export function useShortcutAction(action: ShortcutAction): void {
  const { registerAction } = useKeyboardShortcutsContext();

  useEffect(() => {
    return registerAction(action);
  }, [action, registerAction]);
}

export function useShortcutScope(scope: ShortcutScope): void {
  const { pushScope } = useKeyboardShortcutsContext();

  useEffect(() => {
    return pushScope(scope);
  }, [pushScope, scope]);
}

export function useShortcutActiveRegion(active = true): void {
  const { registerActiveRegion } = useKeyboardShortcutsContext();

  useEffect(() => {
    if (!active) {
      return;
    }

    return registerActiveRegion();
  }, [active, registerActiveRegion]);
}

export function useKeyboardShortcutRegistry(): KeyboardShortcutRegistrySnapshot {
  const { getState } = useKeyboardShortcutsContext();
  return { getState };
}
