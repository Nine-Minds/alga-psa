'use client';

import React, { useMemo, useState } from 'react';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import type { ClientPickerSearchFn } from '@alga-psa/ui/components/AsyncClientPicker';
import { useClientPickerSearch } from '@alga-psa/ui/context';
import { lookupClientsByIds } from '@alga-psa/ui/hooks/useClientNames';
import { getIntegrationClients } from '../../actions/clientLookupActions';
import type { AccountingMappingAlgaPickerProps, AccountingMappingAlgaSearch } from './types';

type ClientFilterState = 'all' | 'active' | 'inactive';
type ClientTypeFilter = 'all' | 'company' | 'individual';

/** The client selector in the mapping dialog: server-searched, already-mapped clients withheld. */
function ClientAlgaPicker({ id, value, onChange, excludeIds, placeholder }: AccountingMappingAlgaPickerProps) {
  // Inactive clients can still be invoiced and exported, so they stay pickable by default.
  const [filterState, setFilterState] = useState<ClientFilterState>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<ClientTypeFilter>('all');
  return (
    <ClientPicker
      id={id}
      selectedClientId={value || null}
      onSelect={(clientId) => onChange(clientId ?? '')}
      excludeIds={excludeIds}
      filterState={filterState}
      onFilterStateChange={setFilterState}
      clientTypeFilter={clientTypeFilter}
      onClientTypeFilterChange={setClientTypeFilter}
      placeholder={placeholder}
      className="w-full"
      modal
    />
  );
}

/**
 * Alga side of a client mapping module. `searchClients` is the shell's `searchClientsForPicker`; it
 * names the mapped clients. The picker reads the same searcher from context.
 */
export function createClientAlgaSearch(searchClients: ClientPickerSearchFn | undefined): AccountingMappingAlgaSearch {
  return {
    Picker: ClientAlgaPicker,
    async resolve(ids) {
      if (ids.length === 0) return [];
      if (!searchClients) {
        throw new Error(
          'Client mappings need the client searcher: mount ClientPickerSearchProvider (the MSP shell does) around the mapping screen.'
        );
      }
      const rows = await lookupClientsByIds(searchClients, ids);
      return rows.map((row) => ({ id: row.client_id, name: row.client_name }));
    },
    async loadAll() {
      // Bulk mapping lists every unmapped client as a row, so it reads the whole list, on demand.
      const clients = await getIntegrationClients(true);
      return clients.map((client) => ({ id: client.client_id, name: client.client_name }));
    },
  };
}

/** The client source for mapping modules, bound to the shell's searcher. */
export function useClientAlgaSearch(): AccountingMappingAlgaSearch {
  const { searchClients } = useClientPickerSearch();
  return useMemo(() => createClientAlgaSearch(searchClients), [searchClients]);
}
