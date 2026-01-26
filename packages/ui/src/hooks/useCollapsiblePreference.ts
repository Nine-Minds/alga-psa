'use client';

import { useState, useEffect } from 'react';
import { getPreferenceWithFallback, savePreference } from '../lib/cookies';

interface UseCollapsiblePreferenceReturn {
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean | ((prev: boolean) => boolean)) => void;
  isInitialLoad: boolean;
  isHidden: boolean;
}

export function useCollapsiblePreference(
  preferenceKey: string,
  defaultCollapsed: boolean = false
): UseCollapsiblePreferenceReturn {
  const [isCollapsed, setIsCollapsedState] = useState<boolean>(defaultCollapsed);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isHidden, setIsHidden] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const preferredState =
      getPreferenceWithFallback(preferenceKey, String(defaultCollapsed)) === 'true';

    setIsCollapsedState(preferredState);

    requestAnimationFrame(() => {
      setIsHidden(false);
      requestAnimationFrame(() => {
        setIsInitialLoad(false);
      });
    });
  }, [preferenceKey, defaultCollapsed]);

  const setIsCollapsed = (value: boolean | ((prev: boolean) => boolean)) => {
    setIsCollapsedState((prev) => {
      const newValue = typeof value === 'function' ? value(prev) : value;
      savePreference(preferenceKey, String(newValue));
      return newValue;
    });
  };

  return {
    isCollapsed,
    setIsCollapsed,
    isInitialLoad,
    isHidden,
  };
}

