'use client';

import React, { useMemo, useCallback, type ReactNode } from 'react';
import { QuickAddClientProvider } from '@alga-psa/ui/context';
import type { QuickAddClientCallbacks, QuickAddClientRenderProps } from '@alga-psa/ui/context';
import QuickAddClient from '@alga-psa/clients/components/clients/QuickAddClient';

export function MspQuickAddClientProvider({ children }: { children: ReactNode }) {
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

  const value = useMemo<QuickAddClientCallbacks>(
    () => ({ renderQuickAddClient }),
    [renderQuickAddClient]
  );

  return (
    <QuickAddClientProvider value={value}>
      {children}
    </QuickAddClientProvider>
  );
}
