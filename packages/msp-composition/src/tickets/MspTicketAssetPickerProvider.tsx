'use client';

import React, { useMemo, type ReactNode } from 'react';
import { ClientAssetMultiSelect } from '@alga-psa/assets/components/ClientAssetMultiSelect';
import { TicketAssetPickerProvider, type TicketAssetPickerCallbacks } from '@alga-psa/ui/context';

/**
 * Gives the ticket-create dialog the client-scoped asset multi-select
 * (alga-2026-0002785). Assets are a PSA-only surface and the tickets package
 * may not import the assets package, so the control arrives through this seam —
 * the same shape MspRecurringTickets uses for the recurring editor.
 */
export function MspTicketAssetPickerProvider({ children }: { children: ReactNode }) {
  const value = useMemo<TicketAssetPickerCallbacks>(
    () => ({ renderAssetPicker: (props) => <ClientAssetMultiSelect {...props} /> }),
    []
  );
  return <TicketAssetPickerProvider value={value}>{children}</TicketAssetPickerProvider>;
}
