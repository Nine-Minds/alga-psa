'use client';


import { useState, useCallback, useRef, useEffect } from 'react';
import { Activity, ActivityFilters, ActivityResponse, ActivityType } from '@alga-psa/types';
import { fetchActivities } from '../actions';

type CacheKey = string;

interface CacheEntry {
  activities: Activity[];
  totalCount: number;
  timestamp: number;
  expiresAt: number;
}

const CACHE_TTL = {
  DEFAULT: 5 * 60 * 1000,
  DRAWER: 10 * 60 * 1000,
  SMALL_DATASET: 15 * 60 * 1000,
};
const CACHE_SIZE_LIMIT = 50;

export function useActivitiesCache() {
  const cache = useRef<Map<CacheKey, CacheEntry>>(new Map());
  const [cacheHits, setCacheHits] = useState(0);
  const [cacheMisses, setCacheMisses] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let expired = 0;

      cache.current.forEach((entry, key) => {
        if (entry.expiresAt < now) {
          cache.current.delete(key);
          expired++;
        }
      });

      if (expired > 0) {
        console.log(`Cleaned up ${expired} expired cache entries`);
      }
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  const generateCacheKey = useCallback((filters: ActivityFilters, page: number, pageSize: number): CacheKey => {
    const filterKeys = Object.keys(filters).sort();
    const filterString = filterKeys
      .map((key) => {
        const value = filters[key as keyof ActivityFilters];
        if (Array.isArray(value)) {
          return `${key}:${value.sort().join(',')}`;
        }
        return `${key}:${value}`;
      })
      .join('|');

    return `${filterString}|page:${page}|size:${pageSize}`;
  }, []);

  const getActivities = useCallback(
    async (filters: ActivityFilters, page: number, pageSize: number): Promise<ActivityResponse> => {
      const cacheKey = generateCacheKey(filters, page, pageSize);
      const now = Date.now();

      if (!isInitialLoad) {
        setIsLoading(true);
      }

      try {
        if (cache.current.has(cacheKey)) {
          const entry = cache.current.get(cacheKey)!;
          if (entry.expiresAt > now) {
            console.log('Cache hit for activities data');
            setCacheHits((prev) => prev + 1);
            await new Promise((resolve) => setTimeout(resolve, 10));

            return {
              activities: entry.activities,
              totalCount: entry.totalCount,
              pageCount: Math.ceil(entry.totalCount / pageSize),
              pageSize,
              pageNumber: page,
            };
          }
        }

        console.log('Cache miss for activities data, fetching from server');
        setCacheMisses((prev) => prev + 1);

        const effectiveFilters: ActivityFilters = {
          ...filters,
          types:
            filters.types && filters.types.length > 0
              ? filters.types
              : Object.values(ActivityType).filter((type) => type !== ActivityType.WORKFLOW_TASK),
        };

        const result = await fetchActivities(effectiveFilters, page, pageSize);

        let cacheTtl = CACHE_TTL.DEFAULT;
        if (pageSize <= 5) {
          cacheTtl = CACHE_TTL.SMALL_DATASET;
        } else if (filters.types && filters.types.length === 1) {
          cacheTtl = CACHE_TTL.DRAWER;
        }

        cache.current.set(cacheKey, {
          activities: result.activities,
          totalCount: result.totalCount,
          timestamp: now,
          expiresAt: now + cacheTtl,
        });

        if (cache.current.size > CACHE_SIZE_LIMIT) {
          const entries = Array.from(cache.current.entries());
          entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
          const toRemove = entries.slice(0, entries.length - CACHE_SIZE_LIMIT);
          toRemove.forEach(([key]) => cache.current.delete(key));
          console.log(`Removed ${toRemove.length} oldest cache entries`);
        }

        if (isInitialLoad) {
          setIsInitialLoad(false);
        }

        return result;
      } finally {
        setIsLoading(false);
      }
    },
    [generateCacheKey, isInitialLoad]
  );

  const clearCache = useCallback(() => {
    cache.current.clear();
    setCacheHits(0);
    setCacheMisses(0);
  }, []);

  const invalidateCache = useCallback((pattern?: string) => {
    if (!pattern) {
      clearCache();
      return;
    }
    cache.current.forEach((_, key) => {
      if (key.includes(pattern)) {
        cache.current.delete(key);
      }
    });
  }, [clearCache]);

  const getCacheStats = useCallback(() => ({
    size: cache.current.size,
    cacheHits,
    cacheMisses,
    hitRate: cacheHits + cacheMisses > 0 ? cacheHits / (cacheHits + cacheMisses) : 0,
  }), [cacheHits, cacheMisses]);

  return {
    getActivities,
    clearCache,
    invalidateCache,
    getCacheStats,
    cacheHits,
    cacheMisses,
    isLoading,
    isInitialLoad,
  };
}
