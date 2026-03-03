'use client';

import useSWR, { mutate as globalMutate } from 'swr';
import { getContactAvatarUrlAction } from '../actions';

/**
 * Hook to fetch and cache contact avatar URL using SWR.
 * When avatar is updated, call refreshAvatar() to invalidate the cache.
 */
export function useContactAvatar(contactId: string | undefined, tenant: string | undefined) {
  const { data: avatarUrl, mutate, isLoading } = useSWR(
    contactId && tenant ? ['contact-avatar', contactId, tenant] : null,
    ([_, id, t]) => getContactAvatarUrlAction(id, t),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  return { avatarUrl: avatarUrl ?? null, refreshAvatar: mutate, isLoading };
}

/**
 * Utility to invalidate contact avatar cache from anywhere (e.g., after upload).
 * Call this after successfully uploading a new avatar.
 */
export function invalidateContactAvatar(contactId: string, tenant: string) {
  return globalMutate(['contact-avatar', contactId, tenant]);
}
