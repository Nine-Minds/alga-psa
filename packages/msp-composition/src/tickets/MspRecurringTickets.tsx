'use client';

import React, { useMemo, type ReactNode } from 'react';
import { ClientAssetMultiSelect } from '@alga-psa/assets/components/ClientAssetMultiSelect';
import {
  RecurringTicketsCrossFeatureProvider,
  type RecurringTicketsCrossFeature,
} from '@alga-psa/tickets/components/recurring/RecurringTicketsFeatureContext';
import { RecurringTicketsPage } from '@alga-psa/tickets/components/recurring/RecurringTicketsPage';
import { RecurringTicketEditor } from '@alga-psa/tickets/components/recurring/RecurringTicketEditor';
import { RecurringTicketsClientSection } from '@alga-psa/tickets/components/recurring/RecurringTicketsClientSection';

/** Supplies the features the tickets package cannot import (the asset picker) to the recurring-ticket UI. */
function MspRecurringTicketsProvider({ children }: { children: ReactNode }) {
  const value = useMemo<RecurringTicketsCrossFeature>(() => ({
    renderAssetPicker: (props) => <ClientAssetMultiSelect {...props} />,
  }), []);
  return <RecurringTicketsCrossFeatureProvider value={value}>{children}</RecurringTicketsCrossFeatureProvider>;
}

export function MspRecurringTicketsPage() {
  return <MspRecurringTicketsProvider><RecurringTicketsPage /></MspRecurringTicketsProvider>;
}

export function MspRecurringTicketEditor({ definitionId }: { definitionId: string }) {
  return <MspRecurringTicketsProvider><RecurringTicketEditor definitionId={definitionId} /></MspRecurringTicketsProvider>;
}

export function MspRecurringTicketsClientSection({ clientId }: { clientId: string }) {
  return <MspRecurringTicketsProvider><RecurringTicketsClientSection clientId={clientId} /></MspRecurringTicketsProvider>;
}
