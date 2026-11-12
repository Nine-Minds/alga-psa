'use client';

import React from 'react';
import { AsyncClientPicker } from '@alga-psa/ui/components/AsyncClientPicker';
import type {
  ClientPickerSearchFn,
  ClientPickerStatusFilter,
  ClientPickerTypeFilter,
} from '@alga-psa/ui/components/AsyncClientPicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { WhereTagSelection } from '../lib/ticketWhereFilters';
import { WhereModeButton } from './WhereModeButton';

interface WhereClientFilterProps {
  id: string;
  searchClients: ClientPickerSearchFn;
  selection: WhereTagSelection | null;
  onChange: (selection: WhereTagSelection | null) => void;
  /** Picker header filters; the caller owns them so a filter reset can restore the defaults. */
  filterState?: ClientPickerStatusFilter;
  onFilterStateChange?: (state: ClientPickerStatusFilter) => void;
  clientTypeFilter?: ClientPickerTypeFilter;
  onClientTypeFilterChange?: (type: ClientPickerTypeFilter) => void;
}

/**
 * Toolbar control for the `client.id` `where` row: pick clients in the server-searched picker, then
 * choose "Any of" or "None of". The row stores client ids; names are looked up by the picker, so the
 * full client list is never loaded.
 */
export function WhereClientFilter({
  id,
  searchClients,
  selection,
  onChange,
  filterState,
  onFilterStateChange,
  clientTypeFilter,
  onClientTypeFilterChange,
}: WhereClientFilterProps) {
  const { t } = useTranslation('features/tickets');

  return (
    <div id={id} className="inline-flex items-center gap-1">
      <AsyncClientPicker
        id="client-picker"
        data-automation-id={`${id}-picker`}
        searchClients={searchClients}
        selectedClientIds={selection?.ids ?? []}
        onSelectedClientIdsChange={(ids) =>
          onChange(ids.length > 0 ? { mode: selection?.mode ?? 'in', ids } : null)
        }
        placeholder={t('filters.allClients', 'All Clients')}
        filterState={filterState}
        onFilterStateChange={onFilterStateChange}
        clientTypeFilter={clientTypeFilter}
        onClientTypeFilterChange={onClientTypeFilterChange}
      />
      <WhereModeButton id={id} selection={selection} onChange={onChange} />
    </div>
  );
}
