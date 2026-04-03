'use client';

import React, { useMemo, useCallback, type ReactNode } from 'react';
import { QuickAddClientProvider } from '@alga-psa/ui/context';
import type { QuickAddClientCallbacks, QuickAddClientRenderProps, QuickAddContactRenderProps } from '@alga-psa/ui/context';
import QuickAddClient from '../components/clients/QuickAddClient';
import QuickAddContact from '../components/contacts/QuickAddContact';

export function QuickAddClientProviderWithCallbacks({ children }: { children: ReactNode }) {
  const renderQuickAddClient = useCallback(
    (props: QuickAddClientRenderProps) => (
      <QuickAddClient
        open={props.open}
        onOpenChange={props.onOpenChange}
        onClientAdded={props.onClientAdded}
        trigger={props.trigger}
        skipSuccessDialog={props.skipSuccessDialog}
      />
    ),
    []
  );

  const renderQuickAddContact = useCallback(
    (props: QuickAddContactRenderProps) => (
      <QuickAddContact
        isOpen={props.isOpen}
        onClose={props.onClose}
        onContactAdded={props.onContactAdded}
        clients={props.clients}
        selectedClientId={props.selectedClientId}
      />
    ),
    []
  );

  const value = useMemo<QuickAddClientCallbacks>(
    () => ({ renderQuickAddClient, renderQuickAddContact }),
    [renderQuickAddClient, renderQuickAddContact]
  );

  return (
    <QuickAddClientProvider value={value}>
      {children}
    </QuickAddClientProvider>
  );
}
