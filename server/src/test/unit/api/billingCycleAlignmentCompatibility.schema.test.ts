import { describe, expect, it } from 'vitest';

import { createFixedPlanConfigSchema } from 'server/src/lib/api/schemas/contractLineSchemas';
import { resolveBillingCycleAlignmentForCompatibility } from '@shared/billingClients/billingCycleAlignmentCompatibility';

describe('billing_cycle_alignment compatibility schema and helper behavior', () => {
  it('T109: fixed config writes can omit billing_cycle_alignment while compatibility reads stay stable', () => {
    const omittedAlignment = createFixedPlanConfigSchema.safeParse({
      base_rate: 125,
      enable_proration: true,
    });

    expect(omittedAlignment.success).toBe(true);
    expect(omittedAlignment.data?.billing_cycle_alignment).toBeUndefined();
    expect(
      resolveBillingCycleAlignmentForCompatibility({
        enableProration: true,
      }),
    ).toBe('prorated');
    expect(
      resolveBillingCycleAlignmentForCompatibility({
        enableProration: false,
        fallbackAlignment: 'end',
      }),
    ).toBe('end');
  });
});
