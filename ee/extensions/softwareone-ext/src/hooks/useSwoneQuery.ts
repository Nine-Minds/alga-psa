import { useQuery, useMutation, useQueryClient, UseQueryOptions } from '@tanstack/react-query';

interface UseSwoneQueryOptions<T> extends Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'> {
  invalidateOnSuccess?: string[];
}

/**
 * Custom hook for SoftwareOne data queries with automatic cache invalidation
 */
export function useSwoneQuery<T>(
  key: string | string[],
  queryFn: () => Promise<T>,
  options?: UseSwoneQueryOptions<T>
) {
  const queryKey = Array.isArray(key) ? key : [key];
  
  return useQuery({
    queryKey: ['swone', ...queryKey],
    queryFn,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 15 * 60 * 1000, // 15 minutes
    ...options
  });
}

/**
 * Custom hook for SoftwareOne mutations with automatic cache invalidation
 */
export function useSwoneMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options?: {
    invalidateKeys?: string[];
    onSuccess?: (data: TData, variables: TVariables) => void;
    onError?: (error: Error, variables: TVariables) => void;
  }
) {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn,
    onSuccess: (data, variables) => {
      // Invalidate specified keys
      if (options?.invalidateKeys) {
        options.invalidateKeys.forEach(key => {
          queryClient.invalidateQueries({ queryKey: ['swone', key] });
        });
      }
      
      // Call custom success handler
      options?.onSuccess?.(data, variables);
    },
    onError: options?.onError
  });
}

/**
 * Hook to get cached SoftwareOne data
 */
export function useSwoneCache<T>(key: string | string[]): T | undefined {
  const queryClient = useQueryClient();
  const queryKey = Array.isArray(key) ? ['swone', ...key] : ['swone', key];
  
  return queryClient.getQueryData<T>(queryKey);
}

/**
 * Hook to manually invalidate SoftwareOne cache
 */
export function useSwoneInvalidate() {
  const queryClient = useQueryClient();
  
  return (keys?: string | string[]) => {
    if (!keys) {
      // Invalidate all SoftwareOne queries
      queryClient.invalidateQueries({ queryKey: ['swone'] });
    } else if (Array.isArray(keys)) {
      keys.forEach(key => {
        queryClient.invalidateQueries({ queryKey: ['swone', key] });
      });
    } else {
      queryClient.invalidateQueries({ queryKey: ['swone', keys] });
    }
  };
}