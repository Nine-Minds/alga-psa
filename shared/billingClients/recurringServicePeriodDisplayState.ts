import type {
  IRecurringServicePeriodDisplayState,
  IRecurringServicePeriodRecord,
} from '@alga-psa/types';

function humanizeReasonCode(reasonCode: string) {
  switch (reasonCode) {
    case 'boundary_adjustment':
      return 'Boundary adjusted';
    case 'invoice_window_adjustment':
      return 'Invoice window adjusted';
    case 'activity_window_adjustment':
      return 'Activity window adjusted';
    case 'skip':
      return 'Skipped by billing staff';
    case 'defer':
      return 'Deferred to a later invoice window';
    case 'source_rule_changed':
      return 'Regenerated after source rule change';
    case 'billing_schedule_changed':
      return 'Regenerated after billing schedule change';
    case 'cadence_owner_changed':
      return 'Regenerated after cadence-owner change';
    case 'activity_window_changed':
      return 'Regenerated after activity-window change';
    case 'backfill_realignment':
      return 'Realigned during backfill';
    case 'integrity_repair':
      return 'Repaired for integrity';
    case 'invoice_linkage_repair':
      return 'Repaired after invoice-linkage correction';
    case 'admin_correction':
      return 'Corrected administratively';
    case 'initial_materialization':
      return 'Generated from source cadence';
    case 'backfill_materialization':
      return 'Generated during backfill';
    default:
      return reasonCode.replaceAll('_', ' ');
  }
}

export function getRecurringServicePeriodDisplayState(
  record: IRecurringServicePeriodRecord,
): IRecurringServicePeriodDisplayState {
  const reasonLabel = humanizeReasonCode(record.provenance.reasonCode);

  switch (record.lifecycleState) {
    case 'generated':
      return {
        lifecycleState: 'generated',
        label: 'Generated',
        tone: 'neutral',
        detail: 'Matches the current cadence rules and is awaiting billing or review.',
        reasonLabel,
      };
    case 'edited':
      return {
        lifecycleState: 'edited',
        label: 'Edited',
        tone: 'accent',
        detail: 'A later revision changed the generated schedule and remains active.',
        reasonLabel,
      };
    case 'skipped':
      return {
        lifecycleState: 'skipped',
        label: 'Skipped',
        tone: 'warning',
        detail: 'This future period is intentionally excluded from due selection until re-edited.',
        reasonLabel,
      };
    case 'locked':
      return {
        lifecycleState: 'locked',
        label: 'Locked',
        tone: 'warning',
        detail: 'This period is frozen for ordinary edits while awaiting billing or correction.',
        reasonLabel,
      };
    case 'billed':
      return {
        lifecycleState: 'billed',
        label: 'Billed',
        tone: 'success',
        detail: record.invoiceLinkage
          ? `Linked to invoice detail ${record.invoiceLinkage.invoiceChargeDetailId}.`
          : 'Linked to billed history.',
        reasonLabel,
      };
    case 'superseded':
      return {
        lifecycleState: 'superseded',
        label: 'Superseded',
        tone: 'muted',
        detail: 'A newer revision replaced this period and this row remains for audit history.',
        reasonLabel,
      };
    case 'archived':
      return {
        lifecycleState: 'archived',
        label: 'Archived',
        tone: 'muted',
        detail: 'This historical row is retained only for audit and reconciliation.',
        reasonLabel,
      };
  }
}
