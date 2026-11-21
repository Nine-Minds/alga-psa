'use client';

import React, { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useDrawer, ClientDrawerContext, type ClientDrawerOptions } from '@alga-psa/ui';
import ClientQuickView from '@alga-psa/clients/components/clients/ClientQuickView';
import { getProjectClientQuickView } from '@alga-psa/projects/actions';
import { MspClientCrossFeatureProvider } from './MspClientCrossFeatureProvider';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function MspClientDrawerProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('msp/clients');
  const { openDrawer, replaceDrawer } = useDrawer();
  const requestId = useRef(0);

  const openClientDrawer = useCallback(async (clientId: string, options?: ClientDrawerOptions) => {
    if (!clientId) return;
    const currentRequestId = ++requestId.current;

    openDrawer(
      <div className="p-4 text-sm text-gray-600">{t('clientDrawer.loading', { defaultValue: 'Loading...' })}</div>,
      undefined,
      undefined,
      '900px'
    );

    try {
      const clientData = await getProjectClientQuickView(clientId, options?.projectId);
      if (currentRequestId !== requestId.current) return;
      if (!clientData) {
        replaceDrawer(
          <div className="p-4 text-sm text-gray-600">{t('clientDrawer.notFound', { defaultValue: 'Client not found.' })}</div>,
          undefined,
          '900px'
        );
        return;
      }
      replaceDrawer(
        <MspClientCrossFeatureProvider>
          <ClientQuickView
            key={clientData.client_id}
            id="client-drawer-details"
            client={clientData}
            isInDrawer={true}
            quickView={true}
            initialPanel={options?.initialPanel}
          />
        </MspClientCrossFeatureProvider>,
        undefined,
        '900px'
      );
    } catch (err) {
      if (currentRequestId !== requestId.current) return;
      console.error('Error fetching client details:', err);
      replaceDrawer(
        <div role="alert" className="p-4 text-sm text-red-600">{err instanceof Error && err.message.includes('Permission denied')
          ? t('clientDrawer.permissionDenied', { defaultValue: 'You do not have permission to view this client.' })
          : t('clientDrawer.loadFailed', { defaultValue: 'Failed to load client details.' })}</div>,
        undefined,
        '900px'
      );
    }
  }, [openDrawer, replaceDrawer, t]);

  const contextValue = useMemo(() => ({ openClientDrawer }), [openClientDrawer]);

  return (
    <ClientDrawerContext value={contextValue}>
      {children}
    </ClientDrawerContext>
  );
}
