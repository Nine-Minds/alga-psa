import { describe, expect, it } from 'vitest';

import {
  ARREARS_ONLY_CONTRACT_LINE_TYPES,
  ContractLineTimingNotAllowedError,
  isAdvanceTimingAllowedForLineType,
  isContractLineTimingNotAllowedError,
  resolveEffectiveBillingTiming,
  resolveRecurringChargeFamily,
} from '../contractLineTimingRule';
import { normalizeRecurringStorageForLineType } from '../recurrenceStorageModel';

describe('contractLineTimingRule', () => {
  it('covers Hourly and Usage only', () => {
    expect([...ARREARS_ONLY_CONTRACT_LINE_TYPES]).toEqual(['Hourly', 'Usage']);
  });

  it.each(['Hourly', 'Usage', 'hourly', 'USAGE', 'time', ' Hourly '])(
    'does not allow advance for %s',
    (lineType) => {
      expect(isAdvanceTimingAllowedForLineType(lineType)).toBe(false);
    },
  );

  it.each(['Fixed', 'Product', 'License', 'Bucket', 'fixed', '', null, undefined])(
    'allows advance for %s',
    (lineType) => {
      expect(isAdvanceTimingAllowedForLineType(lineType)).toBe(true);
    },
  );

  it('resolves the effective timing from the line type whatever is stored', () => {
    expect(resolveEffectiveBillingTiming('Hourly', 'advance')).toBe('arrears');
    expect(resolveEffectiveBillingTiming('Usage', 'advance')).toBe('arrears');
    expect(resolveEffectiveBillingTiming('Hourly', null)).toBe('arrears');
    expect(resolveEffectiveBillingTiming('Fixed', 'advance')).toBe('advance');
    expect(resolveEffectiveBillingTiming('Fixed', 'arrears')).toBe('arrears');
    expect(resolveEffectiveBillingTiming('Fixed', null)).toBe('arrears');
    expect(resolveEffectiveBillingTiming(null, 'advance')).toBe('advance');
  });

  it('exposes a 400 error with a stable code', () => {
    const error = new ContractLineTimingNotAllowedError();
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('CONTRACT_LINE_TIMING_NOT_ALLOWED');
    expect(error.statusCode).toBe(400);
    expect(error.message).toContain('Hourly and usage lines');
    expect(isContractLineTimingNotAllowedError(error)).toBe(true);
    expect(isContractLineTimingNotAllowedError({ code: 'CONTRACT_LINE_TIMING_NOT_ALLOWED' })).toBe(true);
    expect(isContractLineTimingNotAllowedError(new Error('x'))).toBe(false);
  });

  it('classifies line types into recurring charge families', () => {
    expect(resolveRecurringChargeFamily('Hourly')).toBe('hourly');
    expect(resolveRecurringChargeFamily('time')).toBe('hourly');
    expect(resolveRecurringChargeFamily('Usage')).toBe('usage');
    expect(resolveRecurringChargeFamily('Bucket')).toBe('bucket');
    expect(resolveRecurringChargeFamily('Product')).toBe('product');
    expect(resolveRecurringChargeFamily('License')).toBe('license');
    expect(resolveRecurringChargeFamily('Fixed')).toBe('fixed');
    expect(resolveRecurringChargeFamily(null)).toBe('fixed');
    expect(resolveRecurringChargeFamily('whatever')).toBe('fixed');
  });
});

// T8: copy paths never re-create an advance Hourly/Usage row from a legacy source.
describe('normalizeRecurringStorageForLineType', () => {
  const advanceSource = { billing_timing: 'advance' as const, cadence_owner: 'client' as const };

  it.each(['Hourly', 'Usage'])('copies an advance source as arrears for %s', (lineType) => {
    expect(normalizeRecurringStorageForLineType(advanceSource, lineType).billing_timing).toBe('arrears');
  });

  it.each(['Fixed', 'Product', null])('preserves advance for %s', (lineType) => {
    expect(normalizeRecurringStorageForLineType(advanceSource, lineType).billing_timing).toBe('advance');
  });

  it('still defaults a missing timing to arrears and keeps the cadence owner', () => {
    expect(normalizeRecurringStorageForLineType({ cadence_owner: 'contract' }, 'Fixed')).toMatchObject({
      billing_timing: 'arrears',
      cadence_owner: 'contract',
    });
  });
});
