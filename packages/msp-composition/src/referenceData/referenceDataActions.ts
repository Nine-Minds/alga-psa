'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import type { ReferenceListKey } from '@alga-psa/ui/lib/referenceData';
import { loadReferenceListsFor } from './referenceListLoaders';

/**
 * One server action for the shared reference-list cache: a single auth prelude, then each requested
 * list runs the same body as its individual action, in parallel. A list that fails comes back as
 * an error marker for that key only.
 */
export const loadReferenceLists = withAuth(
  async (user, { tenant }, keys: ReferenceListKey[]): Promise<Partial<Record<ReferenceListKey, unknown>>> => {
    const { knex } = await createTenantKnex();
    return loadReferenceListsFor(knex, tenant, user, Array.isArray(keys) ? keys : []);
  }
);
