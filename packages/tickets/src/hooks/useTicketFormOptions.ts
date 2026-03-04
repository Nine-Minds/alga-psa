'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getTicketFormOptions } from '../actions/optimizedTicketActions';

const CACHE_KEY = 'ticket_form_options';
const CACHE_TIMESTAMP_KEY = 'ticket_form_options_ts';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type TicketFormOptions = Awaited<ReturnType<typeof getTicketFormOptions>>;

interface UseTicketFormOptionsResult {
  options: TicketFormOptions | null;
  isLoading: boolean;
  refresh: () => void;
}

function readCache(): { options: TicketFormOptions; timestamp: number } | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    const ts = sessionStorage.getItem(CACHE_TIMESTAMP_KEY);
    if (raw && ts) {
      return { options: JSON.parse(raw), timestamp: Number(ts) };
    }
  } catch { /* ignore */ }
  return null;
}

function writeCache(options: TicketFormOptions): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(options));
    sessionStorage.setItem(CACHE_TIMESTAMP_KEY, String(Date.now()));
  } catch { /* ignore — storage full or unavailable */ }
}

/**
 * Client-side cached hook for ticket form options (statuses, priorities, boards, etc.).
 *
 * Two-phase hydration (same pattern as useUserPreferencesBatch):
 *  Phase 1: Read from sessionStorage (instant, synchronous)
 *  Phase 2: If stale (>5 min) or no cache, fetch from server in background
 *
 * Accepts optional `initialData` from the RSC page load.
 * When provided, it's used immediately and populates the cache.
 */
export function useTicketFormOptions(
  initialData?: TicketFormOptions | null
): UseTicketFormOptionsResult {
  const [options, setOptions] = useState<TicketFormOptions | null>(() => {
    // If RSC provided initial data, use it immediately
    if (initialData) return initialData;
    // Otherwise try the cache
    const cached = readCache();
    return cached?.options ?? null;
  });
  const [isLoading, setIsLoading] = useState(!options);
  const fetchingRef = useRef(false);

  // Populate cache from initialData on first render
  useEffect(() => {
    if (initialData) {
      writeCache(initialData);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch if needed (stale cache or no data)
  useEffect(() => {
    const cached = readCache();
    const isStale = !cached || (Date.now() - cached.timestamp > CACHE_TTL_MS);

    // If we have data (either from RSC or cache) and it's fresh, skip
    if (options && !isStale) {
      setIsLoading(false);
      return;
    }

    // If we have data but it's stale, fetch in background (don't show loading)
    // If we have no data at all, show loading
    if (!options) {
      setIsLoading(true);
    }

    let stale = false;
    const fetchOptions = async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const serverOptions = await getTicketFormOptions();
        if (!stale) {
          setOptions(serverOptions);
          writeCache(serverOptions);
        }
      } catch (err) {
        console.error('[useTicketFormOptions] Failed to fetch form options:', err);
      } finally {
        if (!stale) {
          setIsLoading(false);
          fetchingRef.current = false;
        }
      }
    };

    fetchOptions();
    return () => { stale = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => {
    fetchingRef.current = false;
    const doRefresh = async () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const serverOptions = await getTicketFormOptions();
        setOptions(serverOptions);
        writeCache(serverOptions);
      } catch (err) {
        console.error('[useTicketFormOptions] Failed to refresh form options:', err);
      } finally {
        fetchingRef.current = false;
      }
    };
    doRefresh();
  }, []);

  return { options, isLoading, refresh };
}
