'use client';

import { useEffect, useMemo, useState } from 'react';
import { getCurrentUser, getCurrentUserPermissions } from '@alga-psa/user-composition/actions';
import { getCalendarsVisibleToMe } from '@alga-psa/scheduling/actions';
import type { IScheduleViewerCapabilities } from '@alga-psa/types';

export const SCHEDULE_UPDATE_PERMISSION = 'user_schedule:update';
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

/**
 * Seeing other people's schedules comes from the server's shared-calendar
 * capabilities (user_schedule:update holders see everyone; others see the
 * calendars shared with them), not from a client-side permission check.
 */
export function deriveScheduleViewer(
  currentUserId: string | null,
  permissions: string[] | null,
  error: string | null = null,
  capabilities: Pick<IScheduleViewerCapabilities, 'canViewAll' | 'people'> | null = null
): ScheduleViewer {
  const has = (permission: string) => Boolean(permissions?.includes(permission));
  const canModifySchedule = has(SCHEDULE_UPDATE_PERMISSION);
  const canViewOthers = canModifySchedule || Boolean(capabilities?.canViewAll);
  const sharedWithViewer = new Set((capabilities?.people ?? []).map((person) => person.key));
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
      if (agentId === currentUserId) return canReadOwn;
      return canViewOthers || sharedWithViewer.has(agentId);
    },
  };
}

/** Shared calendars visible to the viewer; a failed load means "none shared". */
async function loadVisibleCalendars() {
  try {
    return await getCalendarsVisibleToMe();
  } catch {
    return null;
  }
}

/** Loads the current user and their schedule permissions once per mount. */
export function useScheduleViewer(loadErrorMessage: string): ScheduleViewer {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<IScheduleViewerCapabilities | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const user = await getCurrentUser();
        if (!active) return;
        setCurrentUserId(user?.user_id ?? null);
        const [loadedPermissions, visible] = await Promise.all([
          getCurrentUserPermissions(),
          loadVisibleCalendars(),
        ]);
        if (!active) return;
        setCapabilities(visible && visible.success ? visible.data : null);
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
    () => deriveScheduleViewer(currentUserId, permissions, error, capabilities),
    [currentUserId, permissions, error, capabilities]
  );
}
