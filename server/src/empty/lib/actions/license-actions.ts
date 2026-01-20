import type { IGetSubscriptionInfoResponse } from '@alga-psa/types';

export async function getSubscriptionInfoAction(): Promise<IGetSubscriptionInfoResponse> {
  return { success: false, error: 'Subscription info is only available in Enterprise Edition.' };
}
