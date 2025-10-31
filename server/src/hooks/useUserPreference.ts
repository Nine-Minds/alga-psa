'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentUser, getUserPreference, setUserPreference } from 'server/src/lib/actions/user-actions/userActions';
import { useToast } from 'server/src/hooks/use-toast';

interface UseUserPreferenceOptions<T> {
  defaultValue: T;
  localStorageKey?: string;
  onError?: (error: Error) => void;
  debounceMs?: number;
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
    debounceMs = 500
  } = options;

  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isUserLoggedIn, setIsUserLoggedIn] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedValueRef = useRef<T | null>(null);

  // Initialize with localStorage value if available to avoid visual flash
  const [value, setValueState] = useState<T>(() => {
    // On client-side, try to read from localStorage immediately
    if (typeof window !== 'undefined' && localStorageKey) {
      try {
        const stored = localStorage.getItem(localStorageKey);
        if (stored !== null) {
          return JSON.parse(stored);
        }
      } catch (e) {
        console.error('Failed to parse localStorage value:', e);
      }
    }
    return defaultValue;
  });

  const [isHydrated, setIsHydrated] = useState(false);
  const [hasLoadedInitial, setHasLoadedInitial] = useState(false);

  // Mark as hydrated and loaded after mount
  useEffect(() => {
    setIsHydrated(true);
    setHasLoadedInitial(true);
  }, []); // Run once on mount

  // Load preference from server
  useEffect(() => {
    // Only load from server after hydration
    if (!isHydrated) return;

    const loadPreference = async () => {
      // Cancel any pending operations
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      try {
        setIsLoading(true);
        setError(null);

        const user = await getCurrentUser();
        setIsUserLoggedIn(!!user);

        if (user && !abortControllerRef.current.signal.aborted) {
          const serverValue = await getUserPreference(user.user_id, preferenceKey);

          if (!abortControllerRef.current.signal.aborted) {
            if (serverValue !== null) {
              setValueState(serverValue);
              lastSavedValueRef.current = serverValue;

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
  }, [isHydrated, preferenceKey, localStorageKey, onError]);

  // Save preference with debouncing
  const savePreference = useCallback(async (newValue: T) => {
    // Skip if value hasn't changed
    if (lastSavedValueRef.current === newValue) {
      return;
    }

    try {
      const user = await getCurrentUser();
      if (user) {
        await setUserPreference(user.user_id, preferenceKey, newValue);
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
  }, [preferenceKey, toast, onError]);

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