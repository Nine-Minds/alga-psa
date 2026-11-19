'use server';

import { withAuth } from '@alga-psa/auth';
import { resolveCoManagedPurchaseDiscovery } from '../co-managed/purchaseDiscovery';

/** Navigation's read of the shared commercial decision: a boolean, never billing data, and no Stripe call. */
export const getCoManagedPurchaseDiscoveryAction = withAuth(async (user, { tenant }): Promise<boolean> =>
  (await resolveCoManagedPurchaseDiscovery(user, tenant)).eligible);
