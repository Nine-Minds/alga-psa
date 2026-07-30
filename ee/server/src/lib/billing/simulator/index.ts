/**
 * EE contract simulator (Workstream B of the billing contract simulator).
 *
 * Resolved by the CE-guarded server actions in
 * packages/billing/src/actions/contractSimulationActions.ts via
 * import('@enterprise/lib/billing/simulator'); the CE stub with the pinned
 * signatures lives at packages/ee/src/lib/billing/simulator/index.ts.
 *
 * Every export here is strictly read-only against the database: a simulation
 * run performs no INSERT/UPDATE/DELETE. Do not import BillingEngine, invoice
 * generation/numbering, or TaxService from this module tree.
 */

export {
  snapshotContractToScenario,
  type SnapshotContractToScenarioParams,
} from './snapshotContractToScenario';
export { simulateContractScenario } from './simulateContractScenario';
export {
  assignServicePeriodsToInvoicePeriods,
  buildInvoicePeriods,
  generateLineServicePeriods,
  isSupportedBillingFrequency,
  monthsPerCycle,
  normalizeBillingCycle,
  type GenerateLineServicePeriodsInput,
  type ServicePeriodAssignment,
  type SimulatedInvoicePeriodWindow,
  type SimulatorBillingCycle,
} from './hypotheticalPeriods';
export {
  assumptionKey,
  buildHourlyServiceConfigMap,
  buildSyntheticTimeEntry,
  hasResolvableHourlyRate,
  resolveAssumedQuantity,
  syntheticConfigId,
  type SyntheticTimeEntryInput,
} from './syntheticActivity';
export {
  createReadOnlyTaxPorts,
  type ReadOnlyTaxPortsOptions,
} from './readOnlyTaxPorts';
