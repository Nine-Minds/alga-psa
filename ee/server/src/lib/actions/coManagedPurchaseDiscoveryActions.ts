'use server';

import { withAuth } from '@alga-psa/auth';
import { resolveCoManagedPurchaseDiscovery } from '../co-managed/purchaseDiscovery';

/** Navigation's read of the shared commercial decision, exposed as a boolean. */
export const getCoManagedPurchaseDiscoveryAction = withAuth(async (user, { tenant }): Promise<boolean> =>
  (await resolveCoManagedPurchaseDiscovery(user, tenant)).eligible);
