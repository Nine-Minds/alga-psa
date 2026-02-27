'use client';

import useSWR, { mutate as globalMutate } from 'swr';
import { getTeamAvatarUrlAction } from '../actions';

/**
 * Hook to fetch and cache team avatar URL using SWR.
 * When avatar is updated, call refreshAvatar() to invalidate the cache.
 */
export function useTeamAvatar(teamId: string | undefined, tenant: string | undefined) {
  const { data: avatarUrl, mutate, isLoading } = useSWR(
    teamId && tenant ? ['team-avatar', teamId, tenant] : null,
    ([_, id, t]) => getTeamAvatarUrlAction(id, t),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  return { avatarUrl: avatarUrl ?? null, refreshAvatar: mutate, isLoading };
}

/**
 * Utility to invalidate team avatar cache from anywhere (e.g., after upload).
 */
export function invalidateTeamAvatar(teamId: string, tenant: string) {
  return globalMutate(['team-avatar', teamId, tenant]);
}
