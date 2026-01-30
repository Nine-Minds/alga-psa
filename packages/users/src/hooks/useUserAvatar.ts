'use client';

import useSWR, { mutate as globalMutate } from 'swr';
import { getUserAvatarUrlAction } from '../actions';

/**
 * Hook to fetch and cache user avatar URL using SWR.
 * When avatar is updated, call refreshAvatar() to invalidate the cache.
 */
export function useUserAvatar(userId: string | undefined, tenant: string | undefined) {
  const { data: avatarUrl, mutate, isLoading } = useSWR(
    userId && tenant ? ['user-avatar', userId, tenant] : null,
    ([_, id, t]) => getUserAvatarUrlAction(id, t),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  return { avatarUrl: avatarUrl ?? null, refreshAvatar: mutate, isLoading };
}

/**
 * Utility to invalidate user avatar cache from anywhere (e.g., after upload).
 * Call this after successfully uploading a new avatar.
 */
export function invalidateUserAvatar(userId: string, tenant: string) {
  return globalMutate(['user-avatar', userId, tenant]);
}
