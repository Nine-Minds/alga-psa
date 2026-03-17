export {
  DEFAULT_CADENCE_OWNER,
  assertHalfOpenDateRange,
  buildRecurringInvoiceDetailTiming,
  calculateServicePeriodCoverage,
  intersectActivityWindow,
  mapServicePeriodToInvoiceWindow,
  resolveCadenceOwner,
  selectCadenceBoundaryGenerator,
} from '@alga-psa/shared/billingClients/recurringTiming';

export type {
  CadenceOwner,
  DuePosition,
  ICadenceBoundaryGenerator,
  ICadenceBoundaryGeneratorInput,
  IRecurringActivityWindow,
  IRecurringCoverage,
  IRecurringInvoiceDetailTiming,
  IRecurringInvoiceWindow,
  IRecurringObligationRef,
  IRecurringServicePeriod,
} from '@alga-psa/types';
