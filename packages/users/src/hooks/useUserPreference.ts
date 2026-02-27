'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentUser, getUserPreferences, setUserPreference } from '../actions';
import { useToast } from '@alga-psa/ui/hooks/use-toast';

type PendingPreferenceBatch = {
  keys: Set<string>;
  resolvers: Map<string, Array<(value: unknown) => void>>;
  rejecters: Map<string, Array<(error: Error) => void>>;
  timer: ReturnType<typeof setTimeout> | null;
};

const preferenceValueCache = new Map<string, Record<string, unknown>>();
const pendingPreferenceBatches = new Map<string, PendingPreferenceBatch>();
let currentUserPromise: Promise<Awaited<ReturnType<typeof getCurrentUser>>> | null = null;

const toError = (value: unknown): Error => {
  if (value instanceof Error) {
    return value;
  }
  return new Error(typeof value === 'string' ? value : 'Unknown error');
};

const getUserPreferenceCache = (userId: string): Record<string, unknown> => {
  const existingCache = preferenceValueCache.get(userId);
  if (existingCache) {
    return existingCache;
  }

  const nextCache: Record<string, unknown> = {};
  preferenceValueCache.set(userId, nextCache);
  return nextCache;
};

const queuePreferenceLoad = (userId: string, preferenceKey: string): Promise<unknown> => {
  const cachedValues = getUserPreferenceCache(userId);
  if (Object.prototype.hasOwnProperty.call(cachedValues, preferenceKey)) {
    return Promise.resolve(cachedValues[preferenceKey]);
  }

  let batch = pendingPreferenceBatches.get(userId);
  if (!batch) {
    batch = {
      keys: new Set<string>(),
      resolvers: new Map<string, Array<(value: unknown) => void>>(),
      rejecters: new Map<string, Array<(error: Error) => void>>(),
      timer: null
    };
    pendingPreferenceBatches.set(userId, batch);
  }

  const batchState = batch;

  return new Promise((resolve, reject) => {
    const existingResolvers = batchState.resolvers.get(preferenceKey) ?? [];
    existingResolvers.push(resolve);
    batchState.resolvers.set(preferenceKey, existingResolvers);

    const existingRejecters = batchState.rejecters.get(preferenceKey) ?? [];
    existingRejecters.push((error: unknown) => reject(toError(error)));
    batchState.rejecters.set(preferenceKey, existingRejecters);

    batchState.keys.add(preferenceKey);

    if (batchState.timer) {
      return;
    }

    batchState.timer = setTimeout(async () => {
      const pendingKeys = Array.from(batchState.keys);
      batchState.keys.clear();
      batchState.timer = null;

      try {
        const values = await getUserPreferences(userId, pendingKeys);
        const userCache = getUserPreferenceCache(userId);

        pendingKeys.forEach((key) => {
          const value = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
          userCache[key] = value;

          const keyResolvers = batchState.resolvers.get(key) ?? [];
          batchState.resolvers.delete(key);
          batchState.rejecters.delete(key);
          keyResolvers.forEach((resolver) => resolver(value));
        });
      } catch (error) {
        const err = toError(error);
        pendingKeys.forEach((key) => {
          const keyRejecters = batchState.rejecters.get(key) ?? [];
          batchState.rejecters.delete(key);
          batchState.resolvers.delete(key);
          keyRejecters.forEach((rejecter) => rejecter(err));
        });
      }
    }, 0);
  });
};

const getCurrentUserCached = async () => {
  if (!currentUserPromise) {
    currentUserPromise = getCurrentUser().catch((error) => {
      currentUserPromise = null;
      throw error;
    });
  }

  return currentUserPromise;
};

interface UseUserPreferenceOptions<T> {
  defaultValue: T;
  localStorageKey?: string;
  onError?: (error: Error) => void;
  debounceMs?: number;
  /** If provided, skips getCurrentUser() call - use when userId is already known */
  userId?: string;
  /** If true, skips server fetch entirely - uses localStorage/defaults only */
  skipServerFetch?: boolean;
}

interface UseUserPreferenceReturn<T> {
  value: T;
  setValue: (value: T | ((prev: T) => T)) => void;
  isLoading: boolean;
  error: Error | null;
  isUserLoggedIn: boolean;
  hasLoadedInitial: boolean;
}

export function useUserPreference<T>(
  preferenceKey: string,
  options: UseUserPreferenceOptions<T>
): UseUserPreferenceReturn<T> {
  const {
    defaultValue,
    localStorageKey = preferenceKey,
    onError,
    debounceMs = 500,
    userId: providedUserId,
    skipServerFetch = false
  } = options;

  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isUserLoggedIn, setIsUserLoggedIn] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedValueRef = useRef<T | null>(null);

  // Start with the default to keep server/client renders consistent (avoids hydration mismatch).
  const [value, setValueState] = useState<T>(defaultValue);

  const [isHydrated, setIsHydrated] = useState(false);
  const [hasLoadedInitial, setHasLoadedInitial] = useState(false);

  // Mark as hydrated and load any persisted local value after mount.
  useEffect(() => {
    if (localStorageKey) {
      try {
        const stored = localStorage.getItem(localStorageKey);
        if (stored !== null) {
          setValueState(JSON.parse(stored));
        }
      } catch (e) {
        console.error('Failed to parse localStorage value:', e);
      }
    }
    setIsHydrated(true);
    setHasLoadedInitial(true);
  }, [localStorageKey]); // Run once on mount (key is stable in practice)

  // Load preference from server
  useEffect(() => {
    // Only load from server after hydration
    if (!isHydrated) return;

    // Skip server fetch if requested - use localStorage/defaults only
    if (skipServerFetch) {
      setIsLoading(false);
      return;
    }

    const loadPreference = async () => {
      // Cancel any pending operations
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      try {
        setIsLoading(true);
        setError(null);

        // Use provided userId if available, otherwise fetch current user
        let userId: string | undefined = providedUserId;
        if (!userId) {
          const user = await getCurrentUserCached();
          userId = user?.user_id;
          setIsUserLoggedIn(!!user);
        } else {
          setIsUserLoggedIn(true);
        }

        if (userId && !abortControllerRef.current.signal.aborted) {
          const serverValue = await queuePreferenceLoad(userId, preferenceKey);

          if (!abortControllerRef.current.signal.aborted) {
            if (serverValue !== null) {
              const typedServerValue = serverValue as T;
              setValueState(typedServerValue);
              lastSavedValueRef.current = typedServerValue;

              // Sync with localStorage
              if (localStorageKey) {
                try {
                  localStorage.setItem(localStorageKey, JSON.stringify(serverValue));
                } catch (e) {
                  console.error('Failed to save to localStorage:', e);
                }
              }
            }
          }
        }
      } catch (err) {
        if (!abortControllerRef.current?.signal.aborted) {
          const error = err as Error;
          setError(error);
          if (onError) {
            onError(error);
          } else {
            console.error('Failed to load user preference:', error);
          }
        }
      } finally {
        if (!abortControllerRef.current?.signal.aborted) {
          setIsLoading(false);
        }
      }
    };

    loadPreference();

    // Cleanup function
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [isHydrated, preferenceKey, localStorageKey, onError, providedUserId, skipServerFetch]);

  // Save preference with debouncing
  const savePreference = useCallback(async (newValue: T) => {
    // Skip server sync if requested
    if (skipServerFetch) {
      return;
    }

    // Skip if value hasn't changed
    if (lastSavedValueRef.current === newValue) {
      return;
    }

    try {
      // Use provided userId if available, otherwise fetch current user
      let userId: string | undefined = providedUserId;
      if (!userId) {
        const user = await getCurrentUserCached();
        userId = user?.user_id;
      }

      if (userId) {
        await setUserPreference(userId, preferenceKey, newValue);
        getUserPreferenceCache(userId)[preferenceKey] = newValue;
        lastSavedValueRef.current = newValue;
      }
    } catch (err) {
      const error = err as Error;
      setError(error);

      // Show error toast
      toast({
        title: "Failed to save preference",
        description: "Your preference has been saved locally but couldn't be synced to the server.",
        variant: "destructive",
      });

      if (onError) {
        onError(error);
      }

      throw error; // Re-throw for proper error propagation
    }
  }, [preferenceKey, toast, onError, providedUserId, skipServerFetch]);

  // Set value with optimistic updates
  const setValue = useCallback((newValue: T | ((prev: T) => T)) => {
    setValueState(prev => {
      const nextValue = typeof newValue === 'function' 
        ? (newValue as (prev: T) => T)(prev) 
        : newValue;

      // Save to localStorage immediately
      if (localStorageKey) {
        try {
          localStorage.setItem(localStorageKey, JSON.stringify(nextValue));
        } catch (e) {
          console.error('Failed to save to localStorage:', e);
        }
      }

      // Cancel any pending save operation
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Debounce server save
      if (isUserLoggedIn) {
        saveTimeoutRef.current = setTimeout(() => {
          savePreference(nextValue).catch(() => {
            // Error already handled in savePreference
          });
        }, debounceMs);
      }

      return nextValue;
    });
  }, [localStorageKey, isUserLoggedIn, savePreference, debounceMs]);

  return {
    value,
    setValue,
    isLoading,
    error,
    isUserLoggedIn,
    hasLoadedInitial
  };
}
