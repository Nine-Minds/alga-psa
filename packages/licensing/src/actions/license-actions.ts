'use server';

import { isSelfHostLicensing } from '../lib/license-state';

/**
 * Client-callable check for whether this install is self-host/on-prem (a
 * `license_state` row is present). Used by the UI to route account/billing to
 * the Nine Minds client portal on-prem instead of the in-app Stripe pages.
 */
export async function isSelfHostLicensingAction(): Promise<boolean> {
  return isSelfHostLicensing();
}
