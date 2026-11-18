'use client';

import type { ReactNode } from 'react';
import { ReferenceDataProvider } from '@alga-psa/ui/lib/referenceData';
import { loadReferenceLists } from './referenceDataActions';

interface MspReferenceDataProviderProps {
  /**
   * Cache identity: tenant + user. Reference lists are user-scoped (tag read scope, project
   * authorization), so the cache must never be shared across users. While it is undefined nothing
   * is fetched.
   */
  scope: string | undefined;
  children: ReactNode;
}

/** Supplies the shared reference-list cache with the batched server action as its loader. */
export function MspReferenceDataProvider({ scope, children }: MspReferenceDataProviderProps) {
  return (
    <ReferenceDataProvider load={loadReferenceLists} scope={scope}>
      {children}
    </ReferenceDataProvider>
  );
}

/** Builds the cache scope from the session identity. Both parts are required. */
export function referenceDataScope(tenant: string | null | undefined, userId: string | null | undefined): string | undefined {
  return tenant && userId ? `${tenant}:${userId}` : undefined;
}
