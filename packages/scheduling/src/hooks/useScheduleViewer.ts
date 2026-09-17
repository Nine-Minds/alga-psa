'use client';

import { useEffect, useMemo, useState } from 'react';
import { getCurrentUser, getCurrentUserPermissions } from '@alga-psa/user-composition/actions';

export const SCHEDULE_UPDATE_PERMISSION = 'user_schedule:update';
const SCHEDULE_READ_ALL_PERMISSION = 'user_schedule:read:all';
const SCHEDULE_READ_PERMISSION = 'user_schedule:read';

/** Who is looking at a schedule, and what the schedule permissions let them do. */
export interface ScheduleViewer {
  currentUserId: string | null;
  permissions: string[] | null;
  /** True once the user and permissions have both resolved (or failed). */
  loaded: boolean;
  error: string | null;
  canModifySchedule: boolean;
  canViewOthers: boolean;
  canReadOwn: boolean;
  canViewAgent: (agentId: string) => boolean;
}

export function deriveScheduleViewer(
  currentUserId: string | null,
  permissions: string[] | null,
  error: string | null = null
): ScheduleViewer {
  const has = (permission: string) => Boolean(permissions?.includes(permission));
  const canModifySchedule = has(SCHEDULE_UPDATE_PERMISSION);
  const canViewOthers = canModifySchedule || has(SCHEDULE_READ_ALL_PERMISSION);
  const canReadOwn = canViewOthers || has(SCHEDULE_READ_PERMISSION);
  const loaded = permissions !== null && currentUserId !== null;

  return {
    currentUserId,
    permissions,
    loaded: loaded || error !== null,
    error,
    canModifySchedule,
    canViewOthers,
    canReadOwn,
    canViewAgent: (agentId: string) => {
      if (!loaded) return false;
      return agentId === currentUserId ? canReadOwn : canViewOthers;
    },
  };
}

/** Loads the current user and their schedule permissions once per mount. */
export function useScheduleViewer(loadErrorMessage: string): ScheduleViewer {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const user = await getCurrentUser();
        if (!active) return;
        setCurrentUserId(user?.user_id ?? null);
        const loadedPermissions = await getCurrentUserPermissions();
        if (!active) return;
        setPermissions(loadedPermissions || []);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : loadErrorMessage);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [loadErrorMessage]);

  return useMemo(
    () => deriveScheduleViewer(currentUserId, permissions, error),
    [currentUserId, permissions, error]
  );
}
