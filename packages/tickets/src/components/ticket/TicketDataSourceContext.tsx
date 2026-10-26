'use client';

import React, { createContext, useCallback, useContext } from 'react';
import { nativeTicketDataSource } from '../../lib/nativeTicketDataSource';
import type {
  TicketCapabilities,
  TicketCapabilityKey,
  TicketDataSource,
  TicketRefreshMode,
} from '../../lib/ticketDataSource';

/**
 * Disabled-default context, modelled on TicketLiveProvider: with no provider
 * mounted every ticket screen runs against the native actions. The default is
 * the module-level singleton, never a per-render object, so hooks that put
 * data-source methods in dependency lists do not churn.
 */
const TicketDataSourceContext = createContext<TicketDataSource>(nativeTicketDataSource);

export interface TicketDataSourceProviderProps {
  /** Build once (module level or `useMemo`); a new identity re-runs dependent effects. */
  dataSource: TicketDataSource;
  children: React.ReactNode;
}

export function TicketDataSourceProvider({ dataSource, children }: TicketDataSourceProviderProps) {
  return (
    <TicketDataSourceContext.Provider value={dataSource}>
      {children}
    </TicketDataSourceContext.Provider>
  );
}

export function useTicketDataSource(): TicketDataSource {
  return useContext(TicketDataSourceContext);
}

/** The screen may be read but not written (for example an ended co-managed workspace). */
export function useTicketScreenReadOnly(): boolean {
  return useContext(TicketDataSourceContext).screen.readOnly === true;
}

export function useTicketCapabilities(): TicketCapabilities {
  return useContext(TicketDataSourceContext).capabilities;
}

/** True when the data source backs the capability. */
export function useTicketCapability(key: TicketCapabilityKey): boolean {
  return useContext(TicketDataSourceContext).capabilities[key];
}

/**
 * Runs the data source's refresh behaviour, falling back to the previous
 * native behaviour: `router.refresh()` for `soft`, `window.location.reload()`
 * for `reload`. Pure function so callers that already hold a router (or none)
 * can use it without a new hook dependency.
 */
export function runTicketRefresh(
  dataSource: Pick<TicketDataSource, 'screen'>,
  mode: TicketRefreshMode,
  router?: { refresh: () => void },
): void {
  if (dataSource.screen.refresh) {
    void dataSource.screen.refresh(mode);
    return;
  }
  if (mode === 'reload') {
    window.location.reload();
    return;
  }
  router?.refresh();
}

/**
 * Hard reload for components that must not require a Next router (comment
 * rows are rendered in tests and drawers without one).
 */
export function useTicketReload(): () => void {
  const dataSource = useContext(TicketDataSourceContext);
  return useCallback(() => runTicketRefresh(dataSource, 'reload'), [dataSource]);
}
