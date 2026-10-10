'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  createActivityGroup,
  getUserActivityGroups,
  moveActivityToGroup,
  removeActivityFromGroups,
  type ActivityGroup,
} from '@alga-psa/user-activities/actions';

export type MyActivityGroupsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface MyActivityGroupsStore {
  /** My groups, or null until the first load. */
  groups: ActivityGroup[] | null;
  status: MyActivityGroupsStatus;
  /** Lazy: the first consumer triggers the load; later calls are no-ops. */
  ensureLoaded(): Promise<void>;
  /** Re-read from the server. Resolves to the loaded groups (or the current ones on failure). */
  refresh(): Promise<ActivityGroup[]>;
  groupOf(type: string, id: string): ActivityGroup | null;
  /** Optimistic; appends at the end of the group. Resolves true on success, false after rollback. */
  moveTo(type: string, id: string, groupId: string): Promise<boolean>;
  /** Optimistic; makes the activity ungrouped. */
  clear(type: string, id: string): Promise<boolean>;
  /** Creates the group, then moves the activity into it. Resolves true on success. */
  createAndMove(name: string, type: string, id: string): Promise<boolean>;
}

const MyActivityGroupsContext = createContext<MyActivityGroupsStore | null>(null);

interface Membership {
  groupId: string;
  sortOrder: number;
}

function membershipOf(groups: ActivityGroup[], type: string, id: string): Membership | null {
  for (const g of groups) {
    const item = g.items.find((i) => i.activityType === type && i.activityId === id);
    if (item) return { groupId: g.groupId, sortOrder: item.sortOrder };
  }
  return null;
}

/** Remove the activity from every group, then (optionally) put it in `target` at `sortOrder`. */
function withMembership(
  groups: ActivityGroup[],
  type: string,
  id: string,
  target: Membership | null,
  makeItemId: () => string
): ActivityGroup[] {
  return groups.map((g) => {
    const items = g.items.filter((i) => !(i.activityType === type && i.activityId === id));
    if (target && g.groupId === target.groupId) {
      const next = [
        ...items,
        { itemId: makeItemId(), activityId: id, activityType: type, sortOrder: target.sortOrder },
      ];
      next.sort((a, b) => a.sortOrder - b.sortOrder);
      return { ...g, items: next };
    }
    return { ...g, items };
  });
}

export function MyActivityGroupsProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('msp/user-activities');
  const [groups, setGroups] = useState<ActivityGroup[] | null>(null);
  const [status, setStatus] = useState<MyActivityGroupsStatus>('idle');

  // Mirrors of state for use inside async callbacks without re-creating them.
  const groupsRef = useRef<ActivityGroup[] | null>(null);
  const statusRef = useRef<MyActivityGroupsStatus>('idle');
  const loadPromiseRef = useRef<Promise<ActivityGroup[]> | null>(null);
  const tempIdRef = useRef(0);
  const tRef = useRef(t);
  tRef.current = t;

  const commit = useCallback((next: ActivityGroup[] | null) => {
    groupsRef.current = next;
    setGroups(next);
  }, []);
  const commitStatus = useCallback((next: MyActivityGroupsStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);
  const makeItemId = useCallback(() => `local-${++tempIdRef.current}`, []);

  const load = useCallback(async (): Promise<ActivityGroup[]> => {
    // Coalesce concurrent loads.
    if (loadPromiseRef.current) return loadPromiseRef.current;
    if (groupsRef.current === null) commitStatus('loading');
    const promise = (async () => {
      try {
        const loaded = await getUserActivityGroups();
        commit(loaded);
        commitStatus('ready');
        return loaded;
      } catch (err) {
        console.error('Error loading my activity groups:', err);
        if (groupsRef.current === null) {
          commitStatus('error');
          toast.error(tRef.current('myGroup.errors.load', { defaultValue: "Couldn't load your groups." }));
        }
        return groupsRef.current ?? [];
      } finally {
        loadPromiseRef.current = null;
      }
    })();
    loadPromiseRef.current = promise;
    return promise;
  }, [commit, commitStatus]);

  const ensureLoaded = useCallback(async () => {
    if (statusRef.current === 'ready' || statusRef.current === 'loading') {
      if (loadPromiseRef.current) await loadPromiseRef.current;
      return;
    }
    await load();
  }, [load]);

  const refresh = useCallback(() => load(), [load]);

  const groupOf = useCallback((type: string, id: string): ActivityGroup | null => {
    if (!groups) return null;
    return groups.find((g) => g.items.some((i) => i.activityType === type && i.activityId === id)) ?? null;
  }, [groups]);

  const moveTo = useCallback(async (type: string, id: string, groupId: string): Promise<boolean> => {
    const current = groupsRef.current ?? [];
    const target = current.find((g) => g.groupId === groupId);
    if (!target) return false;
    const previous = membershipOf(current, type, id);

    // Append: the position is computed with the activity already removed from the target.
    const sortOrder = target.items.filter((i) => !(i.activityType === type && i.activityId === id)).length;
    commit(withMembership(current, type, id, { groupId, sortOrder }, makeItemId));
    try {
      await moveActivityToGroup(id, type, groupId, sortOrder);
      return true;
    } catch (err) {
      console.error('Error moving activity to group:', err);
      // Roll back only this activity's membership so concurrent changes survive.
      commit(withMembership(groupsRef.current ?? [], type, id, previous, makeItemId));
      toast.error(tRef.current('myGroup.errors.move', { defaultValue: "Couldn't change your group. Try again." }));
      return false;
    }
  }, [commit, makeItemId]);

  const clear = useCallback(async (type: string, id: string): Promise<boolean> => {
    const current = groupsRef.current ?? [];
    const previous = membershipOf(current, type, id);
    if (!previous) return true; // already ungrouped
    commit(withMembership(current, type, id, null, makeItemId));
    try {
      await removeActivityFromGroups(id, type);
      return true;
    } catch (err) {
      console.error('Error clearing activity group:', err);
      commit(withMembership(groupsRef.current ?? [], type, id, previous, makeItemId));
      toast.error(tRef.current('myGroup.errors.move', { defaultValue: "Couldn't change your group. Try again." }));
      return false;
    }
  }, [commit, makeItemId]);

  const createAndMove = useCallback(async (name: string, type: string, id: string): Promise<boolean> => {
    let created: ActivityGroup;
    try {
      created = await createActivityGroup(name);
    } catch (err) {
      console.error('Error creating activity group:', err);
      toast.error(tRef.current('myGroup.errors.create', { defaultValue: "Couldn't create the group. Try again." }));
      return false;
    }
    commit([...(groupsRef.current ?? []), created]);
    if (statusRef.current !== 'ready') commitStatus('ready');
    return moveTo(type, id, created.groupId);
  }, [commit, commitStatus, moveTo]);

  // Unmount safety: drop any in-flight load bookkeeping.
  useEffect(() => () => { loadPromiseRef.current = null; }, []);

  const value = useMemo<MyActivityGroupsStore>(
    () => ({ groups, status, ensureLoaded, refresh, groupOf, moveTo, clear, createAndMove }),
    [groups, status, ensureLoaded, refresh, groupOf, moveTo, clear, createAndMove]
  );

  return <MyActivityGroupsContext.Provider value={value}>{children}</MyActivityGroupsContext.Provider>;
}

export function useMyActivityGroups(): MyActivityGroupsStore {
  const ctx = useContext(MyActivityGroupsContext);
  if (!ctx) {
    throw new Error('useMyActivityGroups must be used within a MyActivityGroupsProvider');
  }
  return ctx;
}

/** Like `useMyActivityGroups`, but returns null when no provider is mounted. */
export function useOptionalMyActivityGroups(): MyActivityGroupsStore | null {
  return useContext(MyActivityGroupsContext);
}
