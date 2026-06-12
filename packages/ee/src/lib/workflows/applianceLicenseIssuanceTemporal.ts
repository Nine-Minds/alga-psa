/**
 * Community Edition stub for the appliance license issuance workflow starter.
 *
 * `@enterprise/*` resolves to `packages/ee/src/*` (these CE stubs) at type-check
 * time and is overridden to the real `ee/server/src/*` implementation by the EE
 * webpack alias at runtime. Appliance license issuance is an Enterprise-only
 * feature, so the CE stub keeps the type surface (matching
 * ee/server/src/lib/workflows/applianceLicenseIssuanceTemporal.ts) and throws if
 * ever invoked outside EE.
 */

export interface ApplianceLicenseIssuanceInput {
  tenant: string;
  submissionId: string;
  clientId: string;
  customer: string;
  tier: 'pro' | 'premium';
  seats?: number;
  transport: string;
  stripeSubId: string;
}

export async function startApplianceLicenseIssuance(
  _paymentIntentId: string,
  _input: ApplianceLicenseIssuanceInput
): Promise<{ workflowId: string }> {
  throw new Error(
    'Appliance license issuance is only available in the Enterprise Edition.'
  );
}
