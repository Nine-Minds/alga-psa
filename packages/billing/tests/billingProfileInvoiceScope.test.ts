import { describe, expect, it } from 'vitest';
import {
  chargeBelongsToScope,
  scopeChargesToProfile,
  type InvoiceProfileScope,
} from '../src/lib/billing/billingProfileInvoiceScope';

/**
 * T035/T037 — which charges land on which invoice once profiles bill
 * separately, and the property that nothing is lost in the process.
 *
 * The rule that is easy to get wrong is the second half: a cycle taking *only*
 * its own profile's charges silently drops everything attributed to a sibling
 * profile that does not bill separately. The invoice simply comes out smaller,
 * with nothing on screen to say why.
 */

const DEFAULT_PROFILE = 'profile-default';
const SEPARATE_A = 'profile-a';
const SEPARATE_B = 'profile-b';
const REPORTING_ONLY = 'profile-reporting';

const scopeFor = (billingProfileId: string): InvoiceProfileScope => ({
  isScoped: true,
  billingProfileId,
  isDefaultProfile: billingProfileId === DEFAULT_PROFILE,
  separatelyBillingProfileIds: new Set([SEPARATE_A, SEPARATE_B]),
});

const charge = (billing_profile_id: string | null) => ({ billing_profile_id });

const CHARGES = [
  charge(DEFAULT_PROFILE),
  charge(SEPARATE_A),
  charge(SEPARATE_B),
  charge(REPORTING_ONLY),
  charge(null),
];

describe('T035: charges divide across the invoices their profiles produce', () => {
  it('gives a separately-billing profile exactly its own charges', () => {
    expect(scopeChargesToProfile(CHARGES, scopeFor(SEPARATE_A))).toEqual([charge(SEPARATE_A)]);
    expect(scopeChargesToProfile(CHARGES, scopeFor(SEPARATE_B))).toEqual([charge(SEPARATE_B)]);
  });

  it('gives the default profile everything that is not billed separately', () => {
    // The reporting-only segment and the unattributed charge roll up here —
    // they are segments of the client, not billing entities of their own.
    expect(scopeChargesToProfile(CHARGES, scopeFor(DEFAULT_PROFILE))).toEqual([
      charge(DEFAULT_PROFILE),
      charge(REPORTING_ONLY),
      charge(null),
    ]);
  });

  it('loses nothing: every charge lands on exactly one invoice', () => {
    // The property that matters. A charge on no invoice is unbilled work, and
    // a charge on two is a double bill.
    const placements = CHARGES.map(
      (item) =>
        [DEFAULT_PROFILE, SEPARATE_A, SEPARATE_B].filter((profileId) =>
          chargeBelongsToScope(item, scopeFor(profileId)),
        ).length,
    );
    expect(placements).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('T037: with the feature flag off, generation is unchanged', () => {
  it('an unscoped cycle takes every charge, untouched', () => {
    // `isScoped: false` is what both "the flag is off" and "no profile bills
    // separately" produce. Either way the charge set is returned by identity,
    // so nothing downstream can behave differently.
    const unscoped: InvoiceProfileScope = {
      isScoped: false,
      billingProfileId: DEFAULT_PROFILE,
      isDefaultProfile: true,
      separatelyBillingProfileIds: new Set(),
    };
    expect(scopeChargesToProfile(CHARGES, unscoped)).toBe(CHARGES);
    for (const item of CHARGES) {
      expect(chargeBelongsToScope(item, unscoped)).toBe(true);
    }
  });
});
