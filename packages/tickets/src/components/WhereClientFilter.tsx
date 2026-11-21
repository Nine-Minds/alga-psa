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
import { WhereModeSwitch, useWhereSelectionLabel } from './WhereModeSwitch';

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
 * Toolbar control for the `client.id` `where` row. On the toolbar it is one plain "All Clients"
 * picker: tick one client or several. "Any of" / "None of" sits in the picker's footer, so excluding
 * clients is there when needed and out of the way when not; the trigger reads "Excluding …" then.
 * The row stores client ids; names are looked up by the picker, so the full client list is never
 * loaded.
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
  const selectionLabel = useWhereSelectionLabel();

  return (
    <div id={id} className="inline-flex items-center">
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
        formatSelectedLabel={(label) => selectionLabel(selection, label)}
        footerContent={
          <WhereModeSwitch id={id} selection={selection} onChange={onChange} className="px-2 py-1.5" />
        }
      />
    </div>
  );
}
