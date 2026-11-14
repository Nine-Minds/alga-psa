'use client';

import { useMemo, type ReactNode } from 'react';
import {
  ClientPickerSearchProvider,
  ClientTagsProvider,
  type ClientPickerSearchCallbacks,
  type ClientTagsCallbacks,
} from '@alga-psa/ui/context';
import { searchClientsForPicker } from '@alga-psa/clients/actions/clientPickerActions';
import { findAllTagsByType, findTagsByEntityIds } from '@alga-psa/tags/actions/tagActions';
import { isTagActionError } from '@alga-psa/tags/actions/tagActionErrors';

export function MspClientTagsProvider({ children }: { children: ReactNode }) {
  const value = useMemo<ClientTagsCallbacks>(
    () => ({
      fetchClientTags: async (clientIds: string[]) => {
        if (clientIds.length === 0) return [];
        const tags = await findTagsByEntityIds(clientIds, 'client');
        return isTagActionError(tags) ? [] : tags;
      },
      fetchClientTagOptions: async () => {
        const tags = await findAllTagsByType('client');
        return isTagActionError(tags) ? [] : tags;
      },
    }),
    []
  );

  const searchValue = useMemo<ClientPickerSearchCallbacks>(
    () => ({ searchClients: searchClientsForPicker }),
    []
  );

  return (
    <ClientTagsProvider value={value}>
      <ClientPickerSearchProvider value={searchValue}>{children}</ClientPickerSearchProvider>
    </ClientTagsProvider>
  );
}
