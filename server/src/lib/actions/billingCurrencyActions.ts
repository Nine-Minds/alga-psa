'use server';

import { resolveClientBillingCurrency as resolveClientBillingCurrencyImpl } from '@alga-psa/billing/actions/billingCurrencyActions';

export async function resolveClientBillingCurrency(
  ...args: Parameters<typeof resolveClientBillingCurrencyImpl>
): ReturnType<typeof resolveClientBillingCurrencyImpl> {
  return resolveClientBillingCurrencyImpl(...args);
}
