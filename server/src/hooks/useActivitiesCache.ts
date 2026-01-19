import { useState, useCallback, useRef, useEffect } from 'react';
import { Activity, ActivityFilters, ActivityResponse, ActivityType } from '../interfaces/activity.interfaces';
import { fetchActivities } from '@alga-psa/workflows/actions';

// Define the cache key structure
type CacheKey = string;

// Define the cache entry structure
interface CacheEntry {
  activities: Activity[];
  totalCount: number;
  timestamp: number;
  expiresAt: number;
}

// Cache configuration
const CACHE_TTL = {
  DEFAULT: 5 * 60 * 1000,     // 5 minutes in milliseconds
  DRAWER: 10 * 60 * 1000,     // 10 minutes for drawer operations
  SMALL_DATASET: 15 * 60 * 1000 // 15 minutes for small datasets (like limit=5)
};
const CACHE_SIZE_LIMIT = 50; // Increased maximum number of cache entries

/**
 * Hook for caching and retrieving activities data
 * This helps prevent redundant data fetching and improves performance
 */
export function useActivitiesCache() {
  // Use a ref for the cache to persist between renders without causing re-renders
  const cache = useRef<Map<CacheKey, CacheEntry>>(new Map());
  const [cacheHits, setCacheHits] = useState(0);
  const [cacheMisses, setCacheMisses] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Clean up expired cache entries
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let expired = 0;
      
      // Remove expired entries
      cache.current.forEach((entry, key) => {
        if (entry.expiresAt < now) {
          cache.current.delete(key);
          expired++;
        }
      });
      
      if (expired > 0) {
        console.log(`Cleaned up ${expired} expired cache entries`);
      }
    }, 60000); // Check every minute
    
    return () => clearInterval(interval);
  }, []);

  // Generate a cache key from filters and pagination
  const generateCacheKey = useCallback((
    filters: ActivityFilters,
    page: number,
    pageSize: number
  ): CacheKey => {
    // Create a stable representation of the filters
    const filterKeys = Object.keys(filters).sort();
    const filterString = filterKeys.map(key => {
      const value = filters[key as keyof ActivityFilters];
      if (Array.isArray(value)) {
        return `${key}:${value.sort().join(',')}`;
      }
      return `${key}:${value}`;
    }).join('|');
    
    return `${filterString}|page:${page}|size:${pageSize}`;
  }, []);

  // Get activities with caching
  const getActivities = useCallback(async (
    filters: ActivityFilters,
    page: number,
    pageSize: number
  ): Promise<ActivityResponse> => {
    const cacheKey = generateCacheKey(filters, page, pageSize);
    const now = Date.now();
    
    // Set loading state, but only if it's not the initial load
    // This prevents the table from flashing on subsequent loads
    if (!isInitialLoad) {
      setIsLoading(true);
    }
    
    try {
      // Check if we have a valid cache entry
      if (cache.current.has(cacheKey)) {
        const entry = cache.current.get(cacheKey)!;
        
        // Check if the entry is still valid
        if (entry.expiresAt > now) {
          console.log('Cache hit for activities data');
          setCacheHits(prev => prev + 1);
          
          // Small delay to prevent UI flashing
          await new Promise(resolve => setTimeout(resolve, 10));
          
          return {
            activities: entry.activities,
            totalCount: entry.totalCount,
            pageCount: Math.ceil(entry.totalCount / pageSize),
            pageSize: pageSize,
            pageNumber: page
          };
        }
      }
    
    // Cache miss or expired entry
    console.log('Cache miss for activities data, fetching from server');
    setCacheMisses(prev => prev + 1);
    
    // Prepare effective filters
    const effectiveFilters = {
      ...filters,
      // If types array is empty, explicitly request all activity types
      types: filters.types && filters.types.length > 0
        ? filters.types
        : Object.values(ActivityType).filter(type => type !== ActivityType.WORKFLOW_TASK)
    };
    
      // Fetch from server
      const result = await fetchActivities(effectiveFilters, page, pageSize);
      
      // Determine appropriate TTL based on request characteristics
      let cacheTtl = CACHE_TTL.DEFAULT;
      if (pageSize <= 5) {
        // Small datasets (like in cards view) can be cached longer
        cacheTtl = CACHE_TTL.SMALL_DATASET;
      } else if (filters.types && filters.types.length === 1) {
        // Single activity type requests (like in drawer) can be cached longer
        cacheTtl = CACHE_TTL.DRAWER;
      }
      
      // Update cache
      cache.current.set(cacheKey, {
        activities: result.activities,
        totalCount: result.totalCount,
        timestamp: now,
        expiresAt: now + cacheTtl
      });
    
    // If cache is too large, remove oldest entries
    if (cache.current.size > CACHE_SIZE_LIMIT) {
      const entries = Array.from(cache.current.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      // Remove oldest entries until we're under the limit
      const toRemove = entries.slice(0, entries.length - CACHE_SIZE_LIMIT);
      toRemove.forEach(([key]) => cache.current.delete(key));
      
      console.log(`Removed ${toRemove.length} oldest cache entries`);
    }
    
      // Mark that initial load is complete
      if (isInitialLoad) {
        setIsInitialLoad(false);
      }
      
      return result;
    } finally {
      // Reset loading state
      setIsLoading(false);
    }
  }, [generateCacheKey]);

  // Enhanced invalidation with more options
  const invalidateCache = useCallback((
    options?: {
      filters?: ActivityFilters,
      page?: number,
      pageSize?: number,
      activityType?: ActivityType,
      activityId?: string
    }
  ) => {
    if (!options) {
      // Invalidate all entries
      cache.current.clear();
      console.log('Invalidated entire activities cache');
      return;
    }
    
    const { filters, page, pageSize, activityType, activityId } = options;
    
    if (filters && page && pageSize) {
      // Invalidate specific entry
      const cacheKey = generateCacheKey(filters, page, pageSize);
      cache.current.delete(cacheKey);
      console.log('Invalidated specific cache entry');
    } else if (activityType) {
      // Invalidate all entries for a specific activity type
      const keysToInvalidate: string[] = [];
      
      cache.current.forEach((_, key) => {
        // Check if the key contains this activity type
        if (key.includes(`types:${activityType}`)) {
          keysToInvalidate.push(key);
        }
      });
      
      keysToInvalidate.forEach(key => cache.current.delete(key));
      console.log(`Invalidated ${keysToInvalidate.length} cache entries for activity type: ${activityType}`);
    } else if (activityId) {
      // This is a more aggressive invalidation when a specific activity is updated
      // Since we don't know which cache entries might contain this activity,
      // we invalidate all entries that might be affected
      cache.current.clear();
      console.log(`Invalidated all cache entries due to activity update: ${activityId}`);
    } else {
      // Invalidate all entries
      cache.current.clear();
      console.log('Invalidated entire activities cache');
    }
  }, [generateCacheKey]);

  // Get cache statistics
  const getCacheStats = useCallback(() => {
    return {
      size: cache.current.size,
      hits: cacheHits,
      misses: cacheMisses,
      hitRate: cacheHits + cacheMisses > 0 ? cacheHits / (cacheHits + cacheMisses) : 0
    };
  }, [cacheHits, cacheMisses]);

  return {
    getActivities,
    invalidateCache,
    getCacheStats,
    isLoading,
    isInitialLoad
  };
}
