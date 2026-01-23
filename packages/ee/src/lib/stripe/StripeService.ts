/**
 * CE Stub for StripeService
 * Throws helpful error if accidentally called in CE build
 */

export function getStripeService(): never {
  throw new Error(
    'StripeService is only available in Enterprise Edition for hosted deployments. ' +
    'Self-hosted Community Edition has unlimited users with no license restrictions.'
  );
}

export class StripeService {
  constructor() {
    throw new Error(
      'StripeService is only available in Enterprise Edition for hosted deployments. ' +
      'Self-hosted Community Edition has unlimited users with no license restrictions.'
    );
  }
}
