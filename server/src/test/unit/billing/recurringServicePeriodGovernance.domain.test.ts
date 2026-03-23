import { describe, expect, it } from 'vitest';

import {
  getRecurringServicePeriodGovernanceRequirement,
  listRecurringServicePeriodGovernanceRequirements,
} from '@alga-psa/shared/billingClients/recurringServicePeriodGovernance';
import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';

describe('recurring service period governance', () => {
  it('T303: permissions and audit requirements cover viewing, editing, skipping, regenerating, and correcting persisted service periods', () => {
    const generated = buildRecurringServicePeriodRecord({
      lifecycleState: 'generated',
    });
    const billed = buildRecurringServicePeriodRecord({
      lifecycleState: 'billed',
    });

    expect(getRecurringServicePeriodGovernanceRequirement(generated, 'view')).toEqual({
      action: 'view',
      permissionKey: 'billing.recurring_service_periods.view',
      auditEvent: 'recurring_service_period.viewed',
      auditRequired: false,
      allowed: true,
      reason: 'Service-period rows remain inspectable across lifecycle states when the caller has view permission.',
    });

    expect(getRecurringServicePeriodGovernanceRequirement(generated, 'edit_boundaries')).toMatchObject({
      action: 'edit_boundaries',
      permissionKey: 'billing.recurring_service_periods.manage_future',
      auditEvent: 'recurring_service_period.boundary_adjusted',
      auditRequired: true,
      allowed: true,
    });

    expect(getRecurringServicePeriodGovernanceRequirement(generated, 'skip')).toMatchObject({
      action: 'skip',
      permissionKey: 'billing.recurring_service_periods.manage_future',
      auditEvent: 'recurring_service_period.skipped',
      auditRequired: true,
      allowed: true,
    });

    expect(getRecurringServicePeriodGovernanceRequirement(billed, 'regenerate')).toEqual({
      action: 'regenerate',
      permissionKey: 'billing.recurring_service_periods.regenerate',
      auditEvent: 'recurring_service_period.regenerated',
      auditRequired: true,
      allowed: false,
      reason: 'Locked or billed service periods cannot be edited, skipped, deferred, or regenerated in place.',
    });

    expect(getRecurringServicePeriodGovernanceRequirement(billed, 'invoice_linkage_repair')).toEqual({
      action: 'invoice_linkage_repair',
      permissionKey: 'billing.recurring_service_periods.correct_history',
      auditEvent: 'recurring_service_period.invoice_linkage_repaired',
      auditRequired: true,
      allowed: true,
      reason: 'Locked or billed service periods are immutable except through explicitly allowed corrective flows.',
    });

    expect(listRecurringServicePeriodGovernanceRequirements(billed).map((entry) => entry.action)).toEqual([
      'view',
      'edit_boundaries',
      'skip',
      'defer',
      'regenerate',
      'invoice_linkage_repair',
      'archive',
    ]);
  });
});
