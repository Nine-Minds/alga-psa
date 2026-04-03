import { describe, expect, it } from 'vitest';

import {
  getRecurringServicePeriodAuthorityBoundary,
  listRecurringServicePeriodAuthorityBoundaries,
} from '@alga-psa/shared/billingClients/recurringServicePeriodAuthorityBoundary';

describe('recurring service period authority boundary', () => {
  it('T306: source recurrence rules, materialized overrides, and ledger-state corrections stay queryable through one authority boundary contract', () => {
    expect(getRecurringServicePeriodAuthorityBoundary('cadence_owner')).toEqual({
      subject: 'cadence_owner',
      authorityLayer: 'source_rule',
      changeChannel: 'edit_source_rule',
      futureEffect: 'regenerate_unedited_future',
      reason: 'Cadence owner belongs to the source recurring obligation and future materialized periods follow it through regeneration.',
    });

    expect(getRecurringServicePeriodAuthorityBoundary('service_period_boundary')).toEqual({
      subject: 'service_period_boundary',
      authorityLayer: 'materialized_override',
      changeChannel: 'edit_materialized_period',
      futureEffect: 'supersede_current_revision',
      reason: 'User-adjusted service-period boundaries are explicit persisted overrides, not new source cadence rules.',
    });

    expect(getRecurringServicePeriodAuthorityBoundary('invoice_linkage')).toEqual({
      subject: 'invoice_linkage',
      authorityLayer: 'ledger_state',
      changeChannel: 'corrective_flow',
      futureEffect: 'corrective_only',
      reason: 'Invoice linkage is billed-history lineage and changes only through explicit corrective flows such as linkage repair.',
    });

    expect(listRecurringServicePeriodAuthorityBoundaries().map((entry) => entry.subject)).toEqual([
      'cadence_owner',
      'billing_frequency',
      'due_position',
      'activity_window',
      'service_period_boundary',
      'invoice_window_boundary',
      'skip_disposition',
      'defer_disposition',
      'lifecycle_state',
      'invoice_linkage',
      'provenance',
    ]);
  });
});
