/**
 * CE Stub for StripeService
 * Throws helpful error if accidentally called in CE build
 */

const CE_UNAVAILABLE =
  'StripeService is only available in Enterprise Edition for hosted deployments. ' +
  'Self-hosted Community Edition has unlimited users with no license restrictions.';

export class StripeService {
  constructor() {
    throw new Error(CE_UNAVAILABLE);
  }

  async extendSubscriptionTrialEnd(
    _tenantId: string,
    _stripeSubExternalId: string,
    _newTrialEnd: Date,
  ): Promise<void> {
    throw new Error(CE_UNAVAILABLE);
  }

  async completeIapToStripeTransition(
    _tenantId: string,
    _originalTransactionId: string,
    _stripeSubExternalId: string,
  ): Promise<void> {
    throw new Error(CE_UNAVAILABLE);
  }
}

export function getStripeService(): StripeService {
  throw new Error(CE_UNAVAILABLE);
}
