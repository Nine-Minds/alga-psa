import { describe, expect, it } from 'vitest';
import {
  buildChargeComputeTaxContext,
  type LoadedChargeTaxRate,
} from '../src/lib/billing/compute/taxContext';

/**
 * T033/T044/T045 — profile-scoped tax, and the region chain that deliberately
 * is *not* profile-scoped.
 *
 * The structural claim being tested is that exemption is answered **per charge**
 * from its billing profile, so one invoice can carry both exempt and non-exempt
 * lines. That is not a refinement: `is_tax_exempt` lives on `clients`, so
 * without it a client cannot express "this entity is exempt, that one is not" —
 * and one-site-many-legal-entities is exactly a mix of the two at one address.
 */

const RATES: LoadedChargeTaxRate[] = [
  {
    taxRateId: 'rate-ny',
    regionCode: 'US-NY',
    percentage: 10,
    isActive: true,
    startDate: '2020-01-01',
    endDate: null,
    currencyCode: null,
  },
];

const CLIENT_ID = 'client-1';
const EXEMPT_PROFILE = 'profile-exempt';
const TAXED_PROFILE = 'profile-taxed';
const SILENT_PROFILE = 'profile-inherits';

const context = (overrides?: Partial<Parameters<typeof buildChargeComputeTaxContext>[0]>) =>
  buildChargeComputeTaxContext({
    clientId: CLIENT_ID,
    clientIsTaxExempt: false,
    reverseCharge: false,
    clientDefaultRegion: 'US-NY',
    locationRegions: new Map([['loc-1', 'US-CA']]),
    profileTax: new Map([
      [EXEMPT_PROFILE, { isTaxExempt: true, reverseCharge: null }],
      [TAXED_PROFILE, { isTaxExempt: false, reverseCharge: null }],
      [SILENT_PROFILE, { isTaxExempt: null, reverseCharge: null }],
    ]),
    rates: RATES,
    ...overrides,
  });

describe('T044: one invoice can carry both exempt and non-exempt lines', () => {
  it('answers exemption per profile, not per client', () => {
    const tax = context();
    expect(tax.isTaxExemptForProfile(EXEMPT_PROFILE)).toBe(true);
    expect(tax.isTaxExemptForProfile(TAXED_PROFILE)).toBe(false);
  });

  it('taxes the non-exempt profile and not the exempt one, on the same client', () => {
    const tax = context();
    const args = [CLIENT_ID, 10000, '2025-06-01', 'US-NY', true, 'USD'] as const;

    expect(tax.calculateTax(...args, TAXED_PROFILE)).toEqual({ taxAmount: 1000, taxRate: 10 });
    expect(tax.calculateTax(...args, EXEMPT_PROFILE)).toEqual({ taxAmount: 0, taxRate: 0 });
  });
});

describe('T045: profile tax fields fall back to the client when unset', () => {
  it('a profile with no exemption set inherits the client answer', () => {
    // NULL means inherit. A blob defaulting to {} would silently stop
    // inheriting, which is why these are nullable scalars.
    expect(context().isTaxExemptForProfile(SILENT_PROFILE)).toBe(false);
    expect(
      context({ clientIsTaxExempt: true }).isTaxExemptForProfile(SILENT_PROFILE),
    ).toBe(true);
  });

  it('an explicit false on the profile overrides an exempt client', () => {
    const tax = context({ clientIsTaxExempt: true });
    expect(tax.isTaxExemptForProfile(TAXED_PROFILE)).toBe(false);
    expect(
      tax.calculateTax(CLIENT_ID, 10000, '2025-06-01', 'US-NY', true, 'USD', TAXED_PROFILE),
    ).toEqual({ taxAmount: 1000, taxRate: 10 });
  });

  it('reverse charge is per profile and inherits the same way', () => {
    const tax = buildChargeComputeTaxContext({
      clientId: CLIENT_ID,
      clientIsTaxExempt: false,
      reverseCharge: false,
      clientDefaultRegion: 'US-NY',
      locationRegions: new Map(),
      profileTax: new Map([
        ['profile-reverse', { isTaxExempt: null, reverseCharge: true }],
        ['profile-normal', { isTaxExempt: null, reverseCharge: null }],
      ]),
      rates: RATES,
    });
    const args = [CLIENT_ID, 10000, '2025-06-01', 'US-NY', true, 'USD'] as const;
    expect(tax.calculateTax(...args, 'profile-reverse').taxAmount).toBe(0);
    expect(tax.calculateTax(...args, 'profile-normal').taxAmount).toBe(1000);
  });

  it('a caller with no profile dimension gets the client answer — today’s behaviour', () => {
    // The contract simulator supplies no profileTax at all.
    const tax = buildChargeComputeTaxContext({
      clientId: CLIENT_ID,
      clientIsTaxExempt: false,
      reverseCharge: false,
      clientDefaultRegion: 'US-NY',
      locationRegions: new Map(),
      rates: RATES,
    });
    expect(tax.isTaxExemptForProfile(undefined)).toBe(false);
    expect(tax.isTaxExemptForProfile('any-profile')).toBe(false);
    expect(
      tax.calculateTax(CLIENT_ID, 10000, '2025-06-01', 'US-NY', true, 'USD'),
    ).toEqual({ taxAmount: 1000, taxRate: 10 });
  });
});

describe('T033: the tax region chain is unaffected by billing profiles', () => {
  it('resolves region from the service, then the location, then the client default', () => {
    const tax = context();

    // Service region wins when the service carries a tax rate.
    expect(tax.getTaxInfoFromService({ tax_rate_id: 'rate-ny' })).toEqual({
      taxRegion: 'US-NY',
      isTaxable: true,
    });
    // Contract-line location next.
    expect(tax.getLocationTaxRegionCode('loc-1')).toBe('US-CA');
    // Client default last.
    expect(tax.getClientDefaultTaxRegionCode(CLIENT_ID)).toBe('US-NY');
  });

  it('offers no way for a profile to influence region', () => {
    // The proof is structural: none of the region resolvers accept a profile.
    // A profile's bill-to jurisdiction is not where the work was delivered, and
    // destination sourcing says delivery governs.
    const tax = context();
    expect(tax.getLocationTaxRegionCode.length).toBe(1);
    expect(tax.getClientDefaultTaxRegionCode.length).toBe(1);
    expect(tax.getTaxInfoFromService.length).toBe(1);
  });
});
