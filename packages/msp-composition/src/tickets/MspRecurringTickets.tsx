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

/**
 * The features the tickets package cannot import. Assets are a PSA-only surface, so AlgaDesk gets
 * no asset picker and the recurring-ticket UI hides every asset control.
 */
export function buildRecurringTicketsCrossFeature(isAlgaDeskMode: boolean): RecurringTicketsCrossFeature {
  if (isAlgaDeskMode) return {};
  return { renderAssetPicker: (props) => <ClientAssetMultiSelect {...props} /> };
}

function MspRecurringTicketsProvider({ isAlgaDeskMode, children }: { isAlgaDeskMode: boolean; children: ReactNode }) {
  const value = useMemo(() => buildRecurringTicketsCrossFeature(isAlgaDeskMode), [isAlgaDeskMode]);
  return <RecurringTicketsCrossFeatureProvider value={value}>{children}</RecurringTicketsCrossFeatureProvider>;
}

export function MspRecurringTicketsPage({ isAlgaDeskMode = false }: { isAlgaDeskMode?: boolean }) {
  return <MspRecurringTicketsProvider isAlgaDeskMode={isAlgaDeskMode}><RecurringTicketsPage /></MspRecurringTicketsProvider>;
}

export function MspRecurringTicketEditor({ definitionId, isAlgaDeskMode = false }: { definitionId: string; isAlgaDeskMode?: boolean }) {
  return (
    <MspRecurringTicketsProvider isAlgaDeskMode={isAlgaDeskMode}>
      <RecurringTicketEditor definitionId={definitionId} />
    </MspRecurringTicketsProvider>
  );
}

export function MspRecurringTicketsClientSection({ clientId, isAlgaDeskMode = false }: { clientId: string; isAlgaDeskMode?: boolean }) {
  return (
    <MspRecurringTicketsProvider isAlgaDeskMode={isAlgaDeskMode}>
      <RecurringTicketsClientSection clientId={clientId} />
    </MspRecurringTicketsProvider>
  );
}
