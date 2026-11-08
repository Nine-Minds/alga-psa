'use client';

import { createContext, useContext } from 'react';
import type { ITag } from '@alga-psa/types';

export interface ClientTagsCallbacks {
  fetchClientTags?: (clientIds: string[]) => Promise<ITag[]>;
  /** Distinct client tags (one entry per tag text) for filter controls; not per-client. */
  fetchClientTagOptions?: () => Promise<ITag[]>;
}

const ClientTagsContext = createContext<ClientTagsCallbacks>({});

export const ClientTagsProvider = ClientTagsContext.Provider;

export function useClientTags(): ClientTagsCallbacks {
  return useContext(ClientTagsContext);
}
