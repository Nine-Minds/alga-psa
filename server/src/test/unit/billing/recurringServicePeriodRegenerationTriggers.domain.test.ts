import { describe, expect, it } from 'vitest';

import { resolveRecurringServicePeriodRegenerationDecision } from '@alga-psa/shared/billingClients/recurringServicePeriodRegenerationTriggers';

describe('recurring service period regeneration triggers', () => {
  it('T304 and T305: contract-line, assignment, cadence-owner, and billing-schedule changes classify regeneration triggers explicitly', () => {
    expect(
      resolveRecurringServicePeriodRegenerationDecision({
        source: 'contract_line_edit',
        changedFields: ['billing_frequency', 'rate'],
        cadenceOwnerBefore: 'client',
        cadenceOwnerAfter: 'client',
      }),
    ).toEqual({
      shouldRegenerate: true,
      triggerKind: 'contract_line_edit',
      regenerationReasonCode: 'source_rule_changed',
      scope: 'obligation_schedule_only',
      changedFields: ['billing_frequency', 'rate'],
      affectedCadenceOwners: ['client'],
      preserveEditedRows: true,
      preserveBilledHistory: true,
      reason: 'Contract-line recurrence fields changed (billing_frequency), so future service-period and invoice-window candidates must be rebuilt for that obligation.',
      notes: [
        'Only recurrence-shaping fields trigger service-period regeneration.',
        'Pure pricing changes still affect billing amounts later, but do not rebuild the persisted schedule.',
      ],
    });

    expect(
      resolveRecurringServicePeriodRegenerationDecision({
        source: 'contract_assignment_edit',
        changedFields: ['assignment_end_date'],
        cadenceOwnerBefore: 'contract',
        cadenceOwnerAfter: 'contract',
      }),
    ).toMatchObject({
      shouldRegenerate: true,
      triggerKind: 'contract_assignment_edit',
      regenerationReasonCode: 'activity_window_changed',
      scope: 'obligation_schedule_only',
      affectedCadenceOwners: ['contract'],
    });

    expect(
      resolveRecurringServicePeriodRegenerationDecision({
        source: 'contract_line_edit',
        changedFields: ['cadence_owner'],
        cadenceOwnerBefore: 'client',
        cadenceOwnerAfter: 'contract',
      }),
    ).toEqual({
      shouldRegenerate: true,
      triggerKind: 'cadence_owner_change',
      regenerationReasonCode: 'cadence_owner_changed',
      scope: 'replace_schedule_identity',
      changedFields: ['cadence_owner'],
      affectedCadenceOwners: ['client', 'contract'],
      preserveEditedRows: true,
      preserveBilledHistory: true,
      reason: 'Changing cadence owner replaces the future schedule identity instead of mutating billed history in place.',
      notes: [
        'Supersede untouched future rows on the prior schedule key.',
        'Materialize future rows on the new cadence-owner schedule key.',
        'Preserve edited, locked, and billed rows under the existing override and immutability rules.',
      ],
    });

    expect(
      resolveRecurringServicePeriodRegenerationDecision({
        source: 'billing_schedule_edit',
        changedFields: ['billing_day_of_month', 'memo'],
        cadenceOwnerBefore: 'client',
        cadenceOwnerAfter: 'client',
      }),
    ).toEqual({
      shouldRegenerate: true,
      triggerKind: 'billing_schedule_change',
      regenerationReasonCode: 'billing_schedule_changed',
      scope: 'client_cadence_dependents',
      changedFields: ['billing_day_of_month', 'memo'],
      affectedCadenceOwners: ['client'],
      preserveEditedRows: true,
      preserveBilledHistory: true,
      reason: 'Client billing-schedule fields changed (billing_day_of_month), so client-cadence obligations that depend on that schedule need regenerated future invoice windows.',
      notes: [
        'Only client-cadence obligations are in scope for a billing-schedule trigger.',
        'Contract-cadence schedules keep their own anniversary-owned window identity.',
      ],
    });

    expect(
      resolveRecurringServicePeriodRegenerationDecision({
        source: 'contract_line_edit',
        changedFields: ['rate'],
        cadenceOwnerBefore: 'client',
        cadenceOwnerAfter: 'client',
      }),
    ).toEqual({
      shouldRegenerate: false,
      triggerKind: null,
      regenerationReasonCode: null,
      scope: null,
      changedFields: ['rate'],
      affectedCadenceOwners: ['client'],
      preserveEditedRows: true,
      preserveBilledHistory: true,
      reason: 'No service-period or invoice-window shaping fields changed, so regeneration is not required.',
      notes: [
        'Pricing-only changes do not rebuild persisted future periods.',
        'Override-preservation and immutability rules still apply if a later regeneration is triggered by a different source change.',
      ],
    });
  });
});
