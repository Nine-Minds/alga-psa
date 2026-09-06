'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getStripeService } from '../stripe/StripeService';

export const previewCoManagedSeatsAction = withAuth(async (user, { tenant }, quantity: number) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'account_management', 'update')) throw new Error('Permission denied');
  return getStripeService().previewCoManagedSeats(tenant, quantity);
});

export const purchaseCoManagedSeatsAction = withAuth(async (user, { tenant }, input: { quantity: number; operationId: string }) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'account_management', 'update')) throw new Error('Permission denied');
  const service = getStripeService();
  const result = await service.purchaseCoManagedSeats(tenant, input.quantity, input.operationId);
  return { ...result, publishableKey: result.kind === 'checkout' ? await service.getPublishableKey() : null };
});
