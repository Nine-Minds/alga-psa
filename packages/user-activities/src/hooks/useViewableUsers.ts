'use client';

import { useEffect, useState } from 'react';
import type { IUser } from '@alga-psa/types';
import { getActivityViewableUsers } from '@alga-psa/user-activities/actions';

/**
 * The users whose activities the caller may view. `canViewOthers` is resolved server-side
 * (the schedule "view others" permission); when false the selector must stay hidden.
 */
export function useViewableUsers(): { viewableUsers: IUser[]; canViewOthers: boolean } {
  const [viewableUsers, setViewableUsers] = useState<IUser[]>([]);
  const [canViewOthers, setCanViewOthers] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getActivityViewableUsers()
      .then((result) => {
        if (cancelled) return;
        setCanViewOthers(result.canViewOthers);
        setViewableUsers(result.users);
      })
      .catch((err) => console.error('Error loading viewable users:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  return { viewableUsers, canViewOthers };
}
