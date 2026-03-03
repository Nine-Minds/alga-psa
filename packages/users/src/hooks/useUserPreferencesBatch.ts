'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getCurrentUser, getUserPreferencesBatch, setUserPreference } from '../actions';
import { useToast } from '@alga-psa/ui/hooks/use-toast';

interface PreferenceConfig<T> {
  key: string;
  defaultValue: T;
  localStorageKey?: string;
  debounceMs?: number;
}

interface PreferenceState<T> {
  value: T;
  setValue: (value: T | ((prev: T) => T)) => void;
  isLoading: boolean;
}

/**
 * Batch-loads multiple user preferences in a single server action call
 * instead of N individual calls.
 */
export function useUserPreferencesBatch<T extends Record<string, any>>(
  configs: PreferenceConfig<T[keyof T]>[]
): Record<string, PreferenceState<any>> {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [values, setValues] = useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {};
    for (const config of configs) {
      initial[config.key] = config.defaultValue;
    }
    return initial;
  });
  const userIdRef = useRef<string | null>(null);
  const saveTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});
  const lastSavedRef = useRef<Record<string, any>>({});
  const configsRef = useRef(configs);
  configsRef.current = configs;

  // Hydrate from localStorage, then batch-fetch from server
  useEffect(() => {
    // Step 1: Hydrate from localStorage
    const hydrated: Record<string, any> = {};
    let hasLocalValues = false;
    for (const config of configsRef.current) {
      const lsKey = config.localStorageKey || config.key;
      try {
        const stored = localStorage.getItem(lsKey);
        if (stored !== null) {
          hydrated[config.key] = JSON.parse(stored);
          hasLocalValues = true;
        }
      } catch { /* ignore */ }
    }
    if (hasLocalValues) {
      setValues(prev => ({ ...prev, ...hydrated }));
    }

    // Step 2: Batch-fetch from server
    let stale = false;
    const loadAll = async () => {
      try {
        const user = await getCurrentUser();
        if (stale || !user?.user_id) {
          setIsLoading(false);
          return;
        }
        userIdRef.current = user.user_id;

        const keys = configsRef.current.map(c => c.key);
        const serverValues = await getUserPreferencesBatch(user.user_id, keys);
        if (stale) return;

        const updates: Record<string, any> = {};
        for (const [key, val] of Object.entries(serverValues)) {
          if (val !== undefined) {
            updates[key] = val;
            lastSavedRef.current[key] = val;
            // Sync to localStorage
            const config = configsRef.current.find(c => c.key === key);
            const lsKey = config?.localStorageKey || key;
            try {
              localStorage.setItem(lsKey, JSON.stringify(val));
            } catch { /* ignore */ }
          }
        }

        if (Object.keys(updates).length > 0) {
          setValues(prev => ({ ...prev, ...updates }));
        }
      } catch (err) {
        console.error('Failed to batch-load user preferences:', err);
      } finally {
        if (!stale) setIsLoading(false);
      }
    };

    loadAll();
    return () => {
      stale = true;
      for (const timeout of Object.values(saveTimeoutsRef.current)) {
        clearTimeout(timeout);
      }
    };
  }, []); // Run once on mount

  // Create stable setters for each key
  const setters = useMemo(() => {
    const result: Record<string, (value: any) => void> = {};
    for (const config of configs) {
      result[config.key] = (newValue: any) => {
        setValues(prev => {
          const nextValue = typeof newValue === 'function' ? newValue(prev[config.key]) : newValue;

          // Save to localStorage
          const lsKey = config.localStorageKey || config.key;
          try {
            localStorage.setItem(lsKey, JSON.stringify(nextValue));
          } catch { /* ignore */ }

          // Debounced server save
          if (saveTimeoutsRef.current[config.key]) {
            clearTimeout(saveTimeoutsRef.current[config.key]);
          }
          const debounce = config.debounceMs ?? 500;
          saveTimeoutsRef.current[config.key] = setTimeout(async () => {
            if (lastSavedRef.current[config.key] === nextValue) return;
            const userId = userIdRef.current;
            if (!userId) return;
            try {
              await setUserPreference(userId, config.key, nextValue);
              lastSavedRef.current[config.key] = nextValue;
            } catch {
              toast({
                title: "Failed to save preference",
                description: "Your preference has been saved locally but couldn't be synced to the server.",
                variant: "destructive",
              });
            }
          }, debounce);

          return { ...prev, [config.key]: nextValue };
        });
      };
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configs.map(c => c.key).join(',')]);

  // Build return value
  const result = useMemo(() => {
    const output: Record<string, PreferenceState<any>> = {};
    for (const config of configs) {
      output[config.key] = {
        value: values[config.key],
        setValue: setters[config.key],
        isLoading,
      };
    }
    return output;
  }, [configs, values, setters, isLoading]);

  return result;
}
