import { describe, expect, it } from 'vitest';

import { resolveInitialManualTaxRateId } from '../../src/components/billing-dashboard/manualInvoiceTaxResolution';

const florida = new Map<string, string>([
  ['US-FL', 'fl-6'],
  ['US-NY', 'ny-85'],
]);

describe('resolveInitialManualTaxRateId', () => {
  it('resolves a taxable freeform row with no stored region through the client region (Florida 6%)', () => {
    // The regression: a partial-period line taxed via the client-region fallback
    // has `is_taxable=true` but no `tax_region`. Returning `null` here made the
    // collapsed row commit `tax_rate_id: null` and strip the tax on save.
    const resolved = resolveInitialManualTaxRateId({
      isDiscount: false,
      explicitTaxRateId: undefined,
      isTaxable: true,
      taxRegion: null,
      serviceId: null,
      serviceTaxRateId: null,
      clientRegion: 'US-FL',
      taxRateByRegion: florida,
    });
    expect(resolved).toBe('fl-6');
  });

  it('preserves an unresolvable taxable treatment instead of stripping it to Non-taxable', () => {
    const resolved = resolveInitialManualTaxRateId({
      isDiscount: false,
      explicitTaxRateId: undefined,
      isTaxable: true,
      taxRegion: null,
      serviceId: null,
      serviceTaxRateId: null,
      clientRegion: null,
      taxRateByRegion: florida,
    });
    expect(resolved).toBeUndefined();
  });

  it('keeps an explicit Non-taxable override authoritative', () => {
    expect(
      resolveInitialManualTaxRateId({
        isDiscount: false,
        explicitTaxRateId: null,
        isTaxable: true,
        taxRegion: 'US-FL',
        taxRateByRegion: florida,
      }),
    ).toBeNull();
  });

  it('keeps a row persisted as non-taxable non-taxable regardless of its stored region', () => {
    expect(
      resolveInitialManualTaxRateId({
        isDiscount: false,
        explicitTaxRateId: undefined,
        isTaxable: false,
        taxRegion: 'US-FL',
        taxRateByRegion: florida,
      }),
    ).toBeNull();
  });

  it('prefers a stored region and then the selected service default', () => {
    expect(
      resolveInitialManualTaxRateId({
        isDiscount: false,
        isTaxable: true,
        taxRegion: 'US-NY',
        taxRateByRegion: florida,
      }),
    ).toBe('ny-85');

    expect(
      resolveInitialManualTaxRateId({
        isDiscount: false,
        isTaxable: true,
        serviceTaxRateId: 'svc-rate',
        taxRateByRegion: florida,
      }),
    ).toBe('svc-rate');
  });

  it('never taxes discounts or credits', () => {
    expect(
      resolveInitialManualTaxRateId({
        isDiscount: true,
        isTaxable: true,
        taxRegion: 'US-FL',
        taxRateByRegion: florida,
      }),
    ).toBeNull();
  });
});
