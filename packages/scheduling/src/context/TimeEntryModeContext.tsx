'use client';

import React, { createContext, useContext } from 'react';
import type { CoManagedTimeEntryMode } from '@alga-psa/co-managed/timeEntryBillingMode';

/**
 * The billing mode the SERVER resolved for the signed-in viewer (see `resolveTimeEntryMode`), handed down by a
 * server component the way ticket capabilities are. The dialog gates its commercial reads and fields on it, so
 * nothing is fetched and then hidden. It is presentation only: the save action decides the mode again from the
 * principal and ignores anything the client sends. Without a provider the mode is `commercial`, which is every
 * existing viewer and every test that never mounts one.
 */
const TimeEntryModeContext = createContext<CoManagedTimeEntryMode>('commercial');

export function TimeEntryModeProvider({ mode, children }: { mode: CoManagedTimeEntryMode; children: React.ReactNode }) {
  return <TimeEntryModeContext.Provider value={mode}>{children}</TimeEntryModeContext.Provider>;
}

export function useTimeEntryMode(): CoManagedTimeEntryMode {
  return useContext(TimeEntryModeContext);
}
