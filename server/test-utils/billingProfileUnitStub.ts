/**
 * Stub the client-default billing profile for unit tests that mock the database.
 *
 * Step 5 of the charge-attribution chain reads (and, as a safety net,
 * provisions) the client's one default billing profile. That is a real database
 * dependency, so a suite whose knex is a hand-rolled builder has to answer for
 * it — otherwise every charge calculation fails on a table the mock has never
 * heard of.
 *
 * These suites test charge *timing* and *pricing*, not attribution: the profile
 * is incidental to what they assert, and modelling the table in each bespoke
 * mock would add a fixture nobody reads to prove something nobody is testing.
 * Attribution itself is covered where it belongs — the resolver unit tests and
 * the profile integration suites, which run against a real schema.
 *
 * Usage, at the top of a test file:
 *
 *   vi.mock('@alga-psa/shared/billingClients/billingProfiles', async (importOriginal) =>
 *     (await import('../../../test-utils/billingProfileUnitStub'))
 *       .billingProfilesModuleStub(importOriginal));
 */

export const STUB_DEFAULT_BILLING_PROFILE_ID = 'unit-test-default-billing-profile';

export async function billingProfilesModuleStub(
  importOriginal: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const actual = await importOriginal();
  return {
    ...actual,
    ensureClientDefaultBillingProfile: async () => STUB_DEFAULT_BILLING_PROFILE_ID,
  };
}

/**
 * The companion stub for profile bill-to identity and separate-invoicing
 * (slice S7/S8 reads).
 *
 * Same reasoning as above: a suite testing invoice *header periods* or
 * *duplicate detection* has no opinion about bill-to inheritance, and the
 * unsegmented answer — inherit everything from the client, bill on one invoice
 * — is what these suites have always exercised.
 *
 *   vi.mock('@alga-psa/shared/billingClients/billingProfileSettings', async (importOriginal) =>
 *     (await import('../../../test-utils/billingProfileUnitStub'))
 *       .billingProfileSettingsModuleStub(importOriginal));
 */
export async function billingProfileSettingsModuleStub(
  importOriginal: () => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveEffectiveBillingIdentity: async (
      _knex: unknown,
      _tenant: string,
      _clientId: string,
      billingProfileId?: string | null,
    ) => ({
      billingProfileId: billingProfileId ?? STUB_DEFAULT_BILLING_PROFILE_ID,
      billToName: 'Unit Test Client',
      billToLocationId: null,
      billingContactId: null,
      billingEmail: null,
      isTaxExempt: false,
      taxExemptionCertificate: null,
      taxIdNumber: null,
      poNumber: null,
      poRequired: false,
      invoiceDeliveryMethod: null,
      invoiceTemplateId: null,
      billingCycle: null,
      paymentTerms: null,
      billsSeparately: false,
      // Nothing overridden: the profile inherits the client wholesale, which is
      // what an unsegmented client means.
      overriddenFields: [],
    }),
    // No profile bills separately, so generation runs the single pass it always has.
    listSeparatelyBillingProfiles: async () => [],
  };
}
