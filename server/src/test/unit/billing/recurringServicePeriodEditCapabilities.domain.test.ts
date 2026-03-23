import { describe, expect, it } from 'vitest';

import {
  assertRecurringServicePeriodV1EditOperationSupported,
  isRecurringServicePeriodV1EditOperationSupported,
  RECURRING_SERVICE_PERIOD_SUPPORTED_EDIT_OPERATIONS,
  RECURRING_SERVICE_PERIOD_UNSUPPORTED_V1_EDIT_OPERATIONS,
} from '@alga-psa/shared/billingClients/recurringServicePeriodEditCapabilities';

describe('recurring service period edit capabilities', () => {
  it('T347: split and merge remain explicitly unsupported in v1 while boundary adjustment, skip, and defer stay available', () => {
    expect(RECURRING_SERVICE_PERIOD_SUPPORTED_EDIT_OPERATIONS).toEqual([
      'boundary_adjustment',
      'skip',
      'defer',
    ]);
    expect(RECURRING_SERVICE_PERIOD_UNSUPPORTED_V1_EDIT_OPERATIONS).toEqual([
      'split',
      'merge',
    ]);
    expect(isRecurringServicePeriodV1EditOperationSupported('boundary_adjustment')).toBe(true);
    expect(isRecurringServicePeriodV1EditOperationSupported('skip')).toBe(true);
    expect(isRecurringServicePeriodV1EditOperationSupported('defer')).toBe(true);
    expect(isRecurringServicePeriodV1EditOperationSupported('split')).toBe(false);
    expect(isRecurringServicePeriodV1EditOperationSupported('merge')).toBe(false);
    expect(() => assertRecurringServicePeriodV1EditOperationSupported('split')).toThrow(
      'Recurring service-period split operations are not supported in v1.',
    );
    expect(() => assertRecurringServicePeriodV1EditOperationSupported('merge')).toThrow(
      'Recurring service-period merge operations are not supported in v1.',
    );
  });
});
