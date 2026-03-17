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

export {
  clientCadenceBoundaryGenerator,
  generateClientCadenceServicePeriods,
} from '@alga-psa/shared/billingClients/clientCadenceServicePeriods';

export type {
  ClientCadenceServicePeriodGenerationInput,
  HistoricalBillingCycleBoundary,
} from '@alga-psa/shared/billingClients/clientCadenceServicePeriods';

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
