'use client';

import { useState, useEffect } from 'react';
import { clientCookies } from '../lib/utils/cookies';

interface UseCollapsiblePreferenceReturn {
  isCollapsed: boolean;
  setIsCollapsed: (value: boolean | ((prev: boolean) => boolean)) => void;
  isInitialLoad: boolean;
  isHidden: boolean;
}

/**
 * Hook for managing collapsible component preferences with cookies.
 * Prevents the expand-then-collapse visual jump on page load.
 *
 * @param preferenceKey - Unique key to store the preference
 * @param defaultCollapsed - Default collapsed state (usually false)
 * @returns Object with collapsed state and helper flags
 */
export function useCollapsiblePreference(
  preferenceKey: string,
  defaultCollapsed: boolean = false
): UseCollapsiblePreferenceReturn {
  // Always start with default state during SSR to avoid hydration mismatch
  const [isCollapsed, setIsCollapsedState] = useState<boolean>(defaultCollapsed);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isHidden, setIsHidden] = useState(true);

  // Load the actual preference after mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Get the actual preference
    let preferredState = defaultCollapsed;

    const cookieValue = clientCookies.get(preferenceKey);
    const localValue = localStorage.getItem(preferenceKey);

    if (cookieValue !== undefined) {
      // Use cookie value
      preferredState = cookieValue === 'true';
    } else if (localValue !== null) {
      // Migrate from localStorage to cookie
      preferredState = localValue === 'true';
      clientCookies.set(preferenceKey, String(preferredState), {
        expires: 365,
        sameSite: 'lax',
        path: '/'
      });
    }

    // Update state without transition
    setIsCollapsedState(preferredState);

    // Show the component and enable transitions after next frame
    requestAnimationFrame(() => {
      setIsHidden(false);
      requestAnimationFrame(() => {
        setIsInitialLoad(false);
      });
    });
  }, [preferenceKey, defaultCollapsed]);

  const setIsCollapsed = (value: boolean | ((prev: boolean) => boolean)) => {
    setIsCollapsedState(prev => {
      const newValue = typeof value === 'function' ? value(prev) : value;

      // Save to cookie
      clientCookies.set(preferenceKey, String(newValue), {
        expires: 365,
        sameSite: 'lax',
        path: '/'
      });

      // Also save to localStorage for backup
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(preferenceKey, String(newValue));
        } catch (e) {
          console.error('Failed to save to localStorage:', e);
        }
      }

      return newValue;
    });
  };

  return {
    isCollapsed,
    setIsCollapsed,
    isInitialLoad,
    isHidden
  };
}