'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { matchEvent } from './matcher';
import { hasRadixEscapeOwner } from './escape';
import { parseBinding, parseSequence } from './parser';
import { ShortcutRegistry } from './registry';
import { DEFAULT_PLATFORM, useClientPlatform } from './platform';
import { createMemoryShortcutStorage } from './storage';
import { createShortcutAction, getDefaultBindingsForPlatform, getShortcutCatalogEntry } from './catalog';
import {
  EMPTY_SHORTCUT_PREFERENCES,
  isActionDisabled,
  migrateShortcutPreferences,
  resolveActionBindings,
  setActionBindingsDelta,
  setActionDisabled as setActionDisabledPreference,
  setProfilePreference,
} from './preferences';
import type { PersistedShortcuts, Platform, ShortcutAction, ShortcutScope, ShortcutStorage } from './types';

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
  platform: Platform;
  preferences: PersistedShortcuts;
  preferencesLoaded: boolean;
  getResolvedBindings: (actionId: string) => readonly string[];
  isActionDisabled: (actionId: string) => boolean;
  setActionBindings: (actionId: string, bindings: readonly string[]) => void;
  setActionDisabled: (actionId: string, disabled: boolean) => void;
  resetAction: (actionId: string) => void;
  resetAllShortcuts: () => void;
  profile: string;
  setProfile: (profileId: string) => void;
  getState: () => DispatchState;
}

export interface KeyboardShortcutsProviderProps {
  children: ReactNode;
  platform?: Platform;
  routeKey?: string;
  sequenceTimeoutMs?: number;
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

function requiresActiveRegion(action: ShortcutAction): boolean {
  // Only roving-focus selection actions (j/k/Enter) need a focused list region;
  // page.create/global.quickCreate are page-wide affordances guarded by scope
  // and editable-target suppression instead.
  return action.id.startsWith('selection.');
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
  if (action.scope !== 'global' && !activeScopes.some((entry) => entry.scope === action.scope)) {
    return false;
  }

  if (action.scope === 'page' && activeScopes.some((entry) => entry.scope === 'panel' || entry.scope === 'dialog' || entry.scope === 'editor')) {
    return false;
  }

  return true;
}

export function KeyboardShortcutsProvider({
  children,
  platform,
  routeKey,
  sequenceTimeoutMs = 1000,
  disabledActionIds = [],
  storage,
  onConflict,
}: KeyboardShortcutsProviderProps) {
  const detectedPlatform = useClientPlatform(DEFAULT_PLATFORM);
  const effectivePlatform = platform ?? detectedPlatform;
  const registryRef = useRef(new ShortcutRegistry());
  const defaultStorageRef = useRef(createMemoryShortcutStorage());
  const activeStorage = storage ?? defaultStorageRef.current;
  const [preferences, setPreferences] = useState<PersistedShortcuts>(EMPTY_SHORTCUT_PREFERENCES);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const activeScopesRef = useRef<ScopeEntry[]>([]);
  const activeRegionsRef = useRef<ActiveRegionEntry[]>([]);
  const sequenceBufferRef = useRef<KeyboardEvent[]>([]);
  const sequenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetSequenceBufferRef = useRef<() => void>(() => undefined);
  const platformRef = useRef(effectivePlatform);
  const preferencesRef = useRef<PersistedShortcuts>(preferences);
  const sequenceTimeoutMsRef = useRef(sequenceTimeoutMs);
  const disabledActionIdsRef = useRef<readonly string[]>(disabledActionIds);
  const onConflictRef = useRef(onConflict);
  const previousRouteKeyRef = useRef(routeKey);

  platformRef.current = effectivePlatform;
  preferencesRef.current = preferences;
  sequenceTimeoutMsRef.current = sequenceTimeoutMs;
  disabledActionIdsRef.current = disabledActionIds;
  onConflictRef.current = onConflict;

  const registerAction = useCallback((action: ShortcutAction) => {
    return registryRef.current.add(action);
  }, []);

  const pushScope = useCallback((scope: ShortcutScope) => {
    const entry = { id: nextEntryId++, scope };
    resetSequenceBufferRef.current();
    activeScopesRef.current = [...activeScopesRef.current, entry];

    return () => {
      resetSequenceBufferRef.current();
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

  useEffect(() => {
    let cancelled = false;

    Promise.resolve(activeStorage.load())
      .then((loaded) => {
        if (cancelled) {
          return;
        }

        const migrated = migrateShortcutPreferences(loaded);
        preferencesRef.current = migrated;
        setPreferences(migrated);
        setPreferencesLoaded(true);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        console.error('[KeyboardShortcutsProvider] Failed to load shortcut preferences', error);
        preferencesRef.current = EMPTY_SHORTCUT_PREFERENCES;
        setPreferences(EMPTY_SHORTCUT_PREFERENCES);
        setPreferencesLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [activeStorage]);

  const persistPreferences = useCallback((nextPreferences: PersistedShortcuts) => {
    const migrated = migrateShortcutPreferences(nextPreferences);
    preferencesRef.current = migrated;
    setPreferences(migrated);
    setPreferencesLoaded(true);

    Promise.resolve(activeStorage.save(migrated)).catch((error) => {
      console.error('[KeyboardShortcutsProvider] Failed to save shortcut preferences', error);
    });
  }, [activeStorage]);

  const getResolvedBindings = useCallback((actionId: string) => {
    const action = getShortcutCatalogEntry(actionId);
    if (!action) {
      return [];
    }

    return resolveActionBindings(action, preferencesRef.current, platformRef.current);
  }, []);

  const isDisabledInPreferences = useCallback((actionId: string) => {
    return isActionDisabled(actionId, preferencesRef.current);
  }, []);

  const setActionBindings = useCallback((actionId: string, bindings: readonly string[]) => {
    const action = getShortcutCatalogEntry(actionId);
    if (!action) {
      throw new Error(`Unknown keyboard shortcut action: ${actionId}`);
    }

    persistPreferences(setActionBindingsDelta(preferencesRef.current, action, platformRef.current, bindings));
  }, [persistPreferences]);

  const setActionDisabled = useCallback((actionId: string, disabled: boolean) => {
    persistPreferences(setActionDisabledPreference(preferencesRef.current, actionId, disabled));
  }, [persistPreferences]);

  const resetAction = useCallback((actionId: string) => {
    const action = getShortcutCatalogEntry(actionId);
    if (!action) {
      throw new Error(`Unknown keyboard shortcut action: ${actionId}`);
    }

    const defaults = getDefaultBindingsForPlatform(action, platformRef.current);
    const withoutBinding = setActionBindingsDelta(preferencesRef.current, action, platformRef.current, defaults);
    persistPreferences(setActionDisabledPreference(withoutBinding, actionId, false));
  }, [persistPreferences]);

  const resetAllShortcuts = useCallback(() => {
    persistPreferences({ ...EMPTY_SHORTCUT_PREFERENCES, profile: preferencesRef.current.profile });
  }, [persistPreferences]);

  const setProfile = useCallback((profileId: string) => {
    persistPreferences(setProfilePreference(preferencesRef.current, profileId));
  }, [persistPreferences]);

  const resetSequenceBuffer = useCallback(() => {
    sequenceBufferRef.current = [];
    if (sequenceTimeoutRef.current) {
      clearTimeout(sequenceTimeoutRef.current);
      sequenceTimeoutRef.current = null;
    }
  }, []);
  resetSequenceBufferRef.current = resetSequenceBuffer;

  const scheduleSequenceTimeout = useCallback(() => {
    if (sequenceTimeoutRef.current) {
      clearTimeout(sequenceTimeoutRef.current);
    }

    sequenceTimeoutRef.current = setTimeout(() => {
      sequenceBufferRef.current = [];
      sequenceTimeoutRef.current = null;
    }, sequenceTimeoutMsRef.current);
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
      resetSequenceBuffer();
      previousRouteKeyRef.current = routeKey;
    }
  }, [resetSequenceBuffer, routeKey]);

  useEffect(() => {
    const getEligibleActions = (editableTarget: boolean, sequenceOnly: boolean) => {
      const disabled = new Set([
        ...disabledActionIdsRef.current,
        ...preferencesRef.current.disabled,
      ]);
      return registryRef.current.list().filter((action) => {
        if (Boolean(action.sequence) !== sequenceOnly) {
          return false;
        }

        if (action.enabled === false || disabled.has(action.id)) {
          return false;
        }

        if (!isScopeEligible(action, activeScopesRef.current)) {
          return false;
        }

        if (editableTarget && (!action.allowInEditable || sequenceOnly)) {
          return false;
        }

        return true;
      });
    };

    const resolveWinner = (
      candidates: Array<{
        action: ShortcutAction;
        binding: string;
        scopeIndex: number;
        priority: number;
      }>,
    ) => {
      if (candidates.length === 0) {
        return null;
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
        return null;
      }

      return scopeWinners[0];
    };

    const collectSingleChordCandidates = (event: KeyboardEvent, editableTarget: boolean) => {
      const candidates: Array<{
        action: ShortcutAction;
        binding: string;
        scopeIndex: number;
        priority: number;
      }> = [];

      for (const action of getEligibleActions(editableTarget, false)) {
        const resolvedBindings = resolveActionBindings(action, preferencesRef.current, platformRef.current);
        for (const binding of resolvedBindings) {
          const parsed = parseBinding(binding);
          if (!parsed.ok) {
            continue;
          }

          if (!matchEvent(event, parsed.value, platformRef.current)) {
            continue;
          }

          if (requiresActiveRegion(action) && activeRegionsRef.current.length === 0) {
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

      return candidates;
    };

    const collectSequenceCandidates = (events: readonly KeyboardEvent[], editableTarget: boolean) => {
      const fullMatches: Array<{
        action: ShortcutAction;
        binding: string;
        scopeIndex: number;
        priority: number;
      }> = [];
      let hasPrefix = false;

      if (editableTarget) {
        return { fullMatches, hasPrefix };
      }

      for (const action of getEligibleActions(editableTarget, true)) {
        const resolvedBindings = resolveActionBindings(action, preferencesRef.current, platformRef.current);
        for (const binding of resolvedBindings) {
          const parsed = parseSequence(binding);
          if (!parsed.ok || parsed.value.length < events.length) {
            continue;
          }

          const isMatch = events.every((event, index) => matchEvent(event, parsed.value[index], platformRef.current));
          if (!isMatch) {
            continue;
          }

          if (parsed.value.length === events.length) {
            fullMatches.push({
              action,
              binding,
              scopeIndex: scopeStackIndex(action, activeScopesRef.current),
              priority: action.priority ?? 0,
            });
          } else {
            hasPrefix = true;
          }
        }
      }

      return { fullMatches, hasPrefix };
    };

    const handleSequence = (event: KeyboardEvent, editableTarget: boolean) => {
      if (editableTarget) {
        resetSequenceBuffer();
        return false;
      }

      let nextBuffer = [...sequenceBufferRef.current, event];
      let sequenceCandidates = collectSequenceCandidates(nextBuffer, editableTarget);

      if (sequenceBufferRef.current.length > 0 && !sequenceCandidates.hasPrefix && sequenceCandidates.fullMatches.length === 0) {
        nextBuffer = [event];
        sequenceCandidates = collectSequenceCandidates(nextBuffer, editableTarget);
      }

      const winner = resolveWinner(sequenceCandidates.fullMatches);
      if (winner) {
        resetSequenceBuffer();
        const result = winner.action.handler(event);
        if (result !== false) {
          event.preventDefault();
          return true;
        }
        return false;
      }

      if (sequenceCandidates.hasPrefix) {
        sequenceBufferRef.current = nextBuffer;
        scheduleSequenceTimeout();
      } else {
        resetSequenceBuffer();
      }

      return false;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === 'Escape' && hasRadixEscapeOwner()) {
        return;
      }

      const editableTarget = isEditableTarget(event.target);

      if (handleSequence(event, editableTarget)) {
        return;
      }

      const winner = resolveWinner(collectSingleChordCandidates(event, editableTarget));
      if (!winner) {
        return;
      }

      const result = winner.action.handler(event);
      if (result !== false) {
        event.preventDefault();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      resetSequenceBuffer();
    };
  }, [resetSequenceBuffer, scheduleSequenceTimeout]);

  const value = useMemo<KeyboardShortcutsContextValue>(
    () => ({
      registerAction,
      pushScope,
      registerActiveRegion,
      storage: activeStorage,
      platform: effectivePlatform,
      preferences,
      preferencesLoaded,
      getResolvedBindings,
      isActionDisabled: isDisabledInPreferences,
      setActionBindings,
      setActionDisabled,
      resetAction,
      resetAllShortcuts,
      profile: preferences.profile,
      setProfile,
      getState,
    }),
    [
      activeStorage,
      effectivePlatform,
      getResolvedBindings,
      getState,
      isDisabledInPreferences,
      preferences,
      preferencesLoaded,
      pushScope,
      registerAction,
      registerActiveRegion,
      resetAction,
      resetAllShortcuts,
      setActionBindings,
      setActionDisabled,
      setProfile,
    ],
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

function useOptionalKeyboardShortcutsContext(): KeyboardShortcutsContextValue | null {
  return useContext(KeyboardShortcutsContext);
}

type ShortcutPreferenceApi = Pick<
  KeyboardShortcutsContextValue,
  | 'platform'
  | 'preferences'
  | 'preferencesLoaded'
  | 'getResolvedBindings'
  | 'isActionDisabled'
  | 'setActionBindings'
  | 'setActionDisabled'
  | 'resetAction'
  | 'resetAllShortcuts'
  | 'profile'
  | 'setProfile'
>;

function pickShortcutPreferenceApi(context: KeyboardShortcutsContextValue): ShortcutPreferenceApi {
  return {
    platform: context.platform,
    preferences: context.preferences,
    preferencesLoaded: context.preferencesLoaded,
    getResolvedBindings: context.getResolvedBindings,
    isActionDisabled: context.isActionDisabled,
    setActionBindings: context.setActionBindings,
    setActionDisabled: context.setActionDisabled,
    resetAction: context.resetAction,
    resetAllShortcuts: context.resetAllShortcuts,
    profile: context.profile,
    setProfile: context.setProfile,
  };
}

export function useKeyboardShortcutPreferences(): ShortcutPreferenceApi {
  return pickShortcutPreferenceApi(useKeyboardShortcutsContext());
}

export function useOptionalKeyboardShortcutPreferences(): ShortcutPreferenceApi | null {
  const context = useOptionalKeyboardShortcutsContext();
  return context ? pickShortcutPreferenceApi(context) : null;
}

export function useResolvedShortcutBindings(actionId: string): readonly string[] {
  const context = useOptionalKeyboardShortcutsContext();
  const platform = useClientPlatform(DEFAULT_PLATFORM);
  const action = getShortcutCatalogEntry(actionId);

  if (context) {
    return context.getResolvedBindings(actionId);
  }

  return action ? getDefaultBindingsForPlatform(action, platform) : [];
}

export function useShortcutActionDisabled(actionId: string): boolean {
  const context = useOptionalKeyboardShortcutsContext();
  return context ? context.isActionDisabled(actionId) : false;
}

export function useShortcutStorage(): ShortcutStorage {
  return useKeyboardShortcutsContext().storage;
}

export function useShortcutAction(action: ShortcutAction): void {
  const context = useOptionalKeyboardShortcutsContext();

  useEffect(() => {
    if (!context) {
      return;
    }

    return context.registerAction(action);
  }, [action, context]);
}

export function useCatalogShortcut(
  actionId: string,
  handler: ShortcutAction['handler'],
  options: Pick<ShortcutAction, 'enabled'> = {},
): void {
  const action = useMemo(
    () => createShortcutAction(actionId, handler, options),
    [actionId, handler, options.enabled],
  );

  useShortcutAction(action);
}

export function useShortcutScope(scope: ShortcutScope, active = true): void {
  const context = useOptionalKeyboardShortcutsContext();

  useEffect(() => {
    if (!active || !context) {
      return;
    }

    return context.pushScope(scope);
  }, [active, context, scope]);
}

export function useShortcutActiveRegion(active = true): void {
  const context = useOptionalKeyboardShortcutsContext();

  useEffect(() => {
    if (!active || !context) {
      return;
    }

    return context.registerActiveRegion();
  }, [active, context]);
}

export interface ShortcutActiveRegionProps extends HTMLAttributes<HTMLDivElement> {
  active?: boolean;
}

export function ShortcutActiveRegion({
  active = true,
  children,
  onBlurCapture,
  onFocusCapture,
  tabIndex,
  ...props
}: ShortcutActiveRegionProps): React.JSX.Element {
  const [focusWithin, setFocusWithin] = useState(false);
  useShortcutActiveRegion(active && focusWithin);

  return (
    <div
      {...props}
      data-keyboard-shortcuts-active-region="true"
      tabIndex={tabIndex ?? 0}
      onFocusCapture={(event) => {
        setFocusWithin(true);
        onFocusCapture?.(event);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusWithin(false);
        }
        onBlurCapture?.(event);
      }}
    >
      {children}
    </div>
  );
}

export function useKeyboardShortcutRegistry(): KeyboardShortcutRegistrySnapshot {
  const { getState } = useKeyboardShortcutsContext();
  return { getState };
}
