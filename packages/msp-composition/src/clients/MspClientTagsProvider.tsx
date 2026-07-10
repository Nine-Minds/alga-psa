'use client';

import { useMemo, type ReactNode } from 'react';
import { ClientTagsProvider, type ClientTagsCallbacks } from '@alga-psa/ui/context';
import { findTagsByEntityIds } from '@alga-psa/tags/actions/tagActions';
import { isTagActionError } from '@alga-psa/tags/actions/tagActionErrors';

export function MspClientTagsProvider({ children }: { children: ReactNode }) {
  const value = useMemo<ClientTagsCallbacks>(
    () => ({
      fetchClientTags: async (clientIds: string[]) => {
        if (clientIds.length === 0) return [];
        const tags = await findTagsByEntityIds(clientIds, 'client');
        return isTagActionError(tags) ? [] : tags;
      },
    }),
    []
  );

  return <ClientTagsProvider value={value}>{children}</ClientTagsProvider>;
}
