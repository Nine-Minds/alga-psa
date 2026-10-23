'use client';

import React, { createContext, useContext, type ReactNode } from 'react';

interface ActivityGroupMenuScopeValue {
  enabled: boolean;
}

const ActivityGroupMenuScopeContext = createContext<ActivityGroupMenuScopeValue>({ enabled: true });

/**
 * Gates the action menu's "Move to group" submenu. Defaults to enabled; the board disables it
 * while the caller is viewing another user's list (filing that person's items into the
 * caller's own groups would create orphans).
 */
export function ActivityGroupMenuScope({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return (
    <ActivityGroupMenuScopeContext.Provider value={{ enabled }}>
      {children}
    </ActivityGroupMenuScopeContext.Provider>
  );
}

export function useActivityGroupMenuScope(): ActivityGroupMenuScopeValue {
  return useContext(ActivityGroupMenuScopeContext);
}
