'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { isCoManagedPurchaseSurfaceOpen } from '@alga-psa/licensing';
import { getStripeService } from '../stripe/StripeService';

// LEVERAGE: pattern co-managed-purchase-admission — every purchase entry point repeats "internal user + account_management:update + surface open"; a shared guard belongs below.
async function requirePurchaser(user: { user_type: string }, tenant: string): Promise<void> {
  if (user.user_type !== 'internal' || !await hasPermission(user as never, 'account_management', 'update')) throw new Error('Permission denied');
  // Kill switch, release flag and price: a closed surface is inert, not merely hidden.
  if (!await isCoManagedPurchaseSurfaceOpen(tenant)) throw new Error('Co-managed purchasing is not available');
}

export const previewCoManagedSeatsAction = withAuth(async (user, { tenant }, quantity: number) => {
  await requirePurchaser(user, tenant);
  return getStripeService().previewCoManagedSeats(tenant, quantity);
});

export const purchaseCoManagedSeatsAction = withAuth(async (user, { tenant }, input: { quantity: number; operationId: string }) => {
  await requirePurchaser(user, tenant);
  const service = getStripeService();
  const result = await service.purchaseCoManagedSeats(tenant, input.quantity, input.operationId);
  return { ...result, publishableKey: result.kind === 'checkout' ? await service.getPublishableKey() : null };
});
