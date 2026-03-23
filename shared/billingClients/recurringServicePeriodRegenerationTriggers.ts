import type {
  CadenceOwner,
  IRecurringServicePeriodRegenerationDecision,
  IRecurringServicePeriodRegenerationTriggerInput,
} from '@alga-psa/types';

const CONTRACT_LINE_REGENERATION_FIELDS = new Set([
  'billing_frequency',
  'billing_timing',
  'start_date',
  'end_date',
  'service_start_date',
  'service_end_date',
  'cadence_owner',
]);

const CONTRACT_ASSIGNMENT_REGENERATION_FIELDS = new Set([
  'assignment_start_date',
  'assignment_end_date',
  'service_start_date',
  'service_end_date',
  'start_date',
  'end_date',
]);

const BILLING_SCHEDULE_REGENERATION_FIELDS = new Set([
  'billing_frequency',
  'billing_day_of_month',
  'billing_month',
  'billing_anchor_date',
  'billing_cycle_anchor',
  'next_billing_date',
]);

function uniqueCadenceOwners(owners: Array<CadenceOwner | undefined>) {
  return Array.from(new Set(owners.filter((owner): owner is CadenceOwner => Boolean(owner))));
}

function collectMatchingFields(changedFields: string[], triggerFields: Set<string>) {
  return changedFields.filter((field) => triggerFields.has(field));
}

export function resolveRecurringServicePeriodRegenerationDecision(
  input: IRecurringServicePeriodRegenerationTriggerInput,
): IRecurringServicePeriodRegenerationDecision {
  const changedFields = [...new Set(input.changedFields)];
  const cadenceOwnerChanged = Boolean(
    input.cadenceOwnerBefore
    && input.cadenceOwnerAfter
    && input.cadenceOwnerBefore !== input.cadenceOwnerAfter,
  );

  if (input.source === 'contract_line_edit' && cadenceOwnerChanged) {
    return {
      shouldRegenerate: true,
      triggerKind: 'cadence_owner_change',
      regenerationReasonCode: 'cadence_owner_changed',
      scope: 'replace_schedule_identity',
      changedFields,
      affectedCadenceOwners: uniqueCadenceOwners([
        input.cadenceOwnerBefore,
        input.cadenceOwnerAfter,
      ]),
      preserveEditedRows: true,
      preserveBilledHistory: true,
      reason: 'Changing cadence owner replaces the future schedule identity instead of mutating billed history in place.',
      notes: [
        'Supersede untouched future rows on the prior schedule key.',
        'Materialize future rows on the new cadence-owner schedule key.',
        'Preserve edited, locked, and billed rows under the existing override and immutability rules.',
      ],
    };
  }

  if (input.source === 'contract_line_edit') {
    const triggerFields = collectMatchingFields(changedFields, CONTRACT_LINE_REGENERATION_FIELDS);
    if (triggerFields.length > 0) {
      return {
        shouldRegenerate: true,
        triggerKind: 'contract_line_edit',
        regenerationReasonCode: 'source_rule_changed',
        scope: 'obligation_schedule_only',
        changedFields,
        affectedCadenceOwners: uniqueCadenceOwners([
          input.cadenceOwnerAfter,
          input.cadenceOwnerBefore,
        ]),
        preserveEditedRows: true,
        preserveBilledHistory: true,
        reason: `Contract-line recurrence fields changed (${triggerFields.join(', ')}), so future service-period and invoice-window candidates must be rebuilt for that obligation.`,
        notes: [
          'Only recurrence-shaping fields trigger service-period regeneration.',
          'Pure pricing changes still affect billing amounts later, but do not rebuild the persisted schedule.',
        ],
      };
    }
  }

  if (input.source === 'contract_assignment_edit') {
    const triggerFields = collectMatchingFields(changedFields, CONTRACT_ASSIGNMENT_REGENERATION_FIELDS);
    if (triggerFields.length > 0) {
      return {
        shouldRegenerate: true,
        triggerKind: 'contract_assignment_edit',
        regenerationReasonCode: 'activity_window_changed',
        scope: 'obligation_schedule_only',
        changedFields,
        affectedCadenceOwners: uniqueCadenceOwners([
          input.cadenceOwnerAfter,
          input.cadenceOwnerBefore,
        ]),
        preserveEditedRows: true,
        preserveBilledHistory: true,
        reason: `Assignment activity-window fields changed (${triggerFields.join(', ')}), so future coverage clipping must be regenerated for that obligation.`,
        notes: [
          'This changes activity-window intersection and may alter partial first or final coverage.',
          'Billed history remains immutable and edited future overrides stay preserved.',
        ],
      };
    }
  }

  if (input.source === 'billing_schedule_edit') {
    const triggerFields = collectMatchingFields(changedFields, BILLING_SCHEDULE_REGENERATION_FIELDS);
    if (triggerFields.length > 0) {
      return {
        shouldRegenerate: true,
        triggerKind: 'billing_schedule_change',
        regenerationReasonCode: 'billing_schedule_changed',
        scope: 'client_cadence_dependents',
        changedFields,
        affectedCadenceOwners: ['client'],
        preserveEditedRows: true,
        preserveBilledHistory: true,
        reason: `Client billing-schedule fields changed (${triggerFields.join(', ')}), so client-cadence obligations that depend on that schedule need regenerated future invoice windows.`,
        notes: [
          'Only client-cadence obligations are in scope for a billing-schedule trigger.',
          'Contract-cadence schedules keep their own anniversary-owned window identity.',
        ],
      };
    }
  }

  return {
    shouldRegenerate: false,
    triggerKind: null,
    regenerationReasonCode: null,
    scope: null,
    changedFields,
    affectedCadenceOwners: uniqueCadenceOwners([
      input.cadenceOwnerAfter,
      input.cadenceOwnerBefore,
    ]),
    preserveEditedRows: true,
    preserveBilledHistory: true,
    reason: 'No service-period or invoice-window shaping fields changed, so regeneration is not required.',
    notes: [
      'Pricing-only changes do not rebuild persisted future periods.',
      'Override-preservation and immutability rules still apply if a later regeneration is triggered by a different source change.',
    ],
  };
}
