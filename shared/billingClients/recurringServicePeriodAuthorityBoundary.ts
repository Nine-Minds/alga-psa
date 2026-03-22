import type {
  IRecurringServicePeriodAuthorityBoundary,
  RecurringServicePeriodAuthoritySubject,
} from '@alga-psa/types';

const AUTHORITY_BOUNDARIES: Record<
  RecurringServicePeriodAuthoritySubject,
  IRecurringServicePeriodAuthorityBoundary
> = {
  cadence_owner: {
    subject: 'cadence_owner',
    authorityLayer: 'source_rule',
    changeChannel: 'edit_source_rule',
    futureEffect: 'regenerate_unedited_future',
    reason: 'Cadence owner belongs to the source recurring obligation and future materialized periods follow it through regeneration.',
  },
  billing_frequency: {
    subject: 'billing_frequency',
    authorityLayer: 'source_rule',
    changeChannel: 'edit_source_rule',
    futureEffect: 'regenerate_unedited_future',
    reason: 'Billing frequency defines the canonical service-period cadence and belongs to the source rule set.',
  },
  due_position: {
    subject: 'due_position',
    authorityLayer: 'source_rule',
    changeChannel: 'edit_source_rule',
    futureEffect: 'regenerate_unedited_future',
    reason: 'Advance versus arrears remains a source timing rule that remaps invoice windows for future periods.',
  },
  activity_window: {
    subject: 'activity_window',
    authorityLayer: 'source_rule',
    changeChannel: 'edit_source_rule',
    futureEffect: 'regenerate_unedited_future',
    reason: 'Assignment activity windows come from source contract state and regenerate future coverage clipping when they change.',
  },
  service_period_boundary: {
    subject: 'service_period_boundary',
    authorityLayer: 'materialized_override',
    changeChannel: 'edit_materialized_period',
    futureEffect: 'supersede_current_revision',
    reason: 'User-adjusted service-period boundaries are explicit persisted overrides, not new source cadence rules.',
  },
  invoice_window_boundary: {
    subject: 'invoice_window_boundary',
    authorityLayer: 'materialized_override',
    changeChannel: 'edit_materialized_period',
    futureEffect: 'supersede_current_revision',
    reason: 'Moved due windows such as defer operations live on the materialized row revision and supersede the prior future row.',
  },
  skip_disposition: {
    subject: 'skip_disposition',
    authorityLayer: 'materialized_override',
    changeChannel: 'edit_materialized_period',
    futureEffect: 'supersede_current_revision',
    reason: 'Skipping a future period is an explicit persisted override on one generated row, not a mutation of the source cadence.',
  },
  defer_disposition: {
    subject: 'defer_disposition',
    authorityLayer: 'materialized_override',
    changeChannel: 'edit_materialized_period',
    futureEffect: 'supersede_current_revision',
    reason: 'Deferring a period creates a superseding edited row with a moved invoice window rather than altering the source schedule.',
  },
  lifecycle_state: {
    subject: 'lifecycle_state',
    authorityLayer: 'ledger_state',
    changeChannel: 'corrective_flow',
    futureEffect: 'corrective_only',
    reason: 'Lifecycle transitions describe persisted-ledger state and stay outside ordinary source-rule or override edits once history exists.',
  },
  invoice_linkage: {
    subject: 'invoice_linkage',
    authorityLayer: 'ledger_state',
    changeChannel: 'corrective_flow',
    futureEffect: 'corrective_only',
    reason: 'Invoice linkage is billed-history lineage and changes only through explicit corrective flows such as linkage repair.',
  },
  provenance: {
    subject: 'provenance',
    authorityLayer: 'ledger_state',
    changeChannel: 'corrective_flow',
    futureEffect: 'corrective_only',
    reason: 'Provenance records why a row exists and is additive ledger truth, not an independent source recurrence setting.',
  },
};

export function getRecurringServicePeriodAuthorityBoundary(
  subject: RecurringServicePeriodAuthoritySubject,
): IRecurringServicePeriodAuthorityBoundary {
  return AUTHORITY_BOUNDARIES[subject];
}

export function listRecurringServicePeriodAuthorityBoundaries() {
  return Object.values(AUTHORITY_BOUNDARIES);
}
