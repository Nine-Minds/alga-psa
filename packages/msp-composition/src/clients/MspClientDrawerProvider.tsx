'use client';

import React, { useCallback, useMemo, type ReactNode } from 'react';
import { useDrawer, ClientDrawerContext } from '@alga-psa/ui';
import ClientDetails from '@alga-psa/clients/components/clients/ClientDetails';
import { getClientByIdForAssets } from '@alga-psa/assets/actions/clientLookupActions';
import { MspClientCrossFeatureProvider } from './MspClientCrossFeatureProvider';

export function MspClientDrawerProvider({ children }: { children: ReactNode }) {
  const { openDrawer, replaceDrawer } = useDrawer();

  const openClientDrawer = useCallback(async (clientId: string) => {
    if (!clientId) return;

    openDrawer(
      <div className="p-4 text-sm text-gray-600">Loading...</div>,
      undefined,
      undefined,
      '900px'
    );

    try {
      const clientData = await getClientByIdForAssets(clientId);
      if (!clientData) {
        replaceDrawer(
          <div className="p-4 text-sm text-gray-600">Client not found.</div>,
          undefined,
          '900px'
        );
        return;
      }
      replaceDrawer(
        <MspClientCrossFeatureProvider>
          <ClientDetails
            id="client-drawer-details"
            client={clientData}
            isInDrawer={true}
            quickView={true}
          />
        </MspClientCrossFeatureProvider>,
        undefined,
        '900px'
      );
    } catch (err) {
      console.error('Error fetching client details:', err);
      replaceDrawer(
        <div className="p-4 text-sm text-red-600">Failed to load client details.</div>,
        undefined,
        '900px'
      );
    }
  }, [openDrawer, replaceDrawer]);

  const contextValue = useMemo(() => ({ openClientDrawer }), [openClientDrawer]);

  return (
    <ClientDrawerContext value={contextValue}>
      {children}
    </ClientDrawerContext>
  );
}
