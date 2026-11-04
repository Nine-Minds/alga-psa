import React from 'react';
import { ClientAssetMultiSelect } from '@alga-psa/assets/components/ClientAssetMultiSelect';
import type { QuickAddAssetPickerProps } from '@alga-psa/tickets/components/QuickAddTicket';

/**
 * The multi-asset picker for Quick Add. The tickets package cannot import assets, so every MSP
 * surface that renders <QuickAddTicket> passes this as `renderAssetPicker`; without it the dialog's
 * Assets section degrades to "can be linked after it is created".
 */
// LEVERAGE: pattern client-asset-picker-render — CreateTicketRouteClient and MspRecurringTickets inline the same `<ClientAssetMultiSelect {...props} />` lambda
export function renderQuickAddAssetPicker(props: QuickAddAssetPickerProps): React.ReactNode {
  return <ClientAssetMultiSelect {...props} />;
}
