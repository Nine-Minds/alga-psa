'use client';

import React, { createContext, useContext, useMemo } from 'react';
import type { AssetSurfaceAccess } from '../actions/assetActions';

/** Nothing closed: what every screen rendered before seat technicians had a read-only asset surface. */
const OPEN: AssetSurfaceAccess = { closedActions: [], closedOperations: [], closedFields: [] };

const AssetSurfaceAccessContext = createContext<AssetSurfaceAccess>(OPEN);

/**
 * Supplies the asset screens with what the server's seat authority closes for the signed-in user. The host page
 * reads it once with `getAssetSurfaceAccess` and passes it in, so the controls are never rendered and then removed.
 * Without a provider every control renders, as before.
 */
export function AssetSurfaceAccessProvider({ access, children }: { access?: AssetSurfaceAccess | null; children: React.ReactNode }) {
  const value = access ?? OPEN;
  return <AssetSurfaceAccessContext.Provider value={value}>{children}</AssetSurfaceAccessContext.Provider>;
}

export interface AssetSurfaceControls {
  /** Asset create (new asset, import, intake). */
  canCreate: boolean;
  /** Asset edit, bulk edit, assignment, notes, custody and the other writes the asset update action covers. */
  canUpdate: boolean;
  canDelete: boolean;
  /** Remote-access links and remote control. */
  canRemoteAccess: boolean;
  /** Reboot, script and other commands sent to the device. */
  canRunRmmCommands: boolean;
  /** Pulling the device's data from its RMM. */
  canRefreshRmm: boolean;
  /** Everything read-only: no create, update or delete. */
  readOnly: boolean;
}

export function useAssetSurfaceControls(): AssetSurfaceControls {
  const access = useContext(AssetSurfaceAccessContext);
  return useMemo(() => {
    const action = (name: string) => !access.closedActions.includes(name);
    const operation = (name: string) => !access.closedOperations.includes(name);
    return {
      canCreate: action('create'),
      canUpdate: action('update'),
      canDelete: action('delete'),
      canRemoteAccess: operation('remote_access'),
      canRunRmmCommands: operation('rmm_command'),
      canRefreshRmm: operation('rmm_refresh'),
      readOnly: !action('create') && !action('update') && !action('delete'),
    };
  }, [access]);
}
