import { describe, expect, it } from 'vitest';

import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';
import { evaluateRecurringServicePeriodMutationPermission } from '@alga-psa/shared/billingClients/recurringServicePeriodMutations';

describe('recurring service-period mutation policy', () => {
  it('T290: locked or billed persisted service periods reject normal edits and allow only explicit corrective flows', () => {
    const generated = buildRecurringServicePeriodRecord({
      lifecycleState: 'generated',
    });
    const locked = buildRecurringServicePeriodRecord({
      lifecycleState: 'locked',
    });
    const billed = buildRecurringServicePeriodRecord({
      lifecycleState: 'billed',
    });

    expect(evaluateRecurringServicePeriodMutationPermission(generated, 'edit_boundaries')).toEqual({
      allowed: true,
      reason: 'Future unlocked service periods can still be updated through normal edit or regeneration flows.',
    });
    expect(evaluateRecurringServicePeriodMutationPermission(generated, 'invoice_linkage_repair')).toEqual({
      allowed: false,
      reason: 'Invoice linkage repair is only valid after the service period is locked or billed.',
    });

    expect(evaluateRecurringServicePeriodMutationPermission(locked, 'edit_boundaries')).toEqual({
      allowed: false,
      reason: 'Locked or billed service periods cannot be edited, skipped, deferred, or regenerated in place.',
    });
    expect(evaluateRecurringServicePeriodMutationPermission(locked, 'invoice_linkage_repair')).toEqual({
      allowed: true,
      reason: 'Locked or billed service periods are immutable except through explicitly allowed corrective flows.',
    });

    expect(evaluateRecurringServicePeriodMutationPermission(billed, 'regenerate')).toEqual({
      allowed: false,
      reason: 'Locked or billed service periods cannot be edited, skipped, deferred, or regenerated in place.',
    });
    expect(evaluateRecurringServicePeriodMutationPermission(billed, 'archive')).toEqual({
      allowed: true,
      reason: 'Locked or billed service periods are immutable except through explicitly allowed corrective flows.',
    });
  });
});
