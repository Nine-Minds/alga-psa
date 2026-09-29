/**
 * Server-facing entry point for the nightly contract-cadence service-period
 * replenishment sweep.
 *
 * The orchestration lives in `@alga-psa/billing` so that both the server's
 * legacy pg-boss schedule and the Enterprise maintenance fan-out (Temporal)
 * invoke the exact same implementation. The job name is owned by
 * `@alga-psa/types` so the Temporal worker can schedule it without importing the
 * billing domain graph.
 */

export {
  CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME,
  CONTRACT_CADENCE_REPLENISHMENT_SOURCE_RUN_PREFIX,
  CONTRACT_CADENCE_REPLENISHMENT_TENANT_ENUMERATION,
  replenishContractCadenceServicePeriodsSweep,
  summarizeContractCadenceReplenishment,
} from '@alga-psa/billing/actions/contractCadenceServicePeriodMaterialization';

export type {
  ContractCadenceReplenishmentSweepOptions,
  ContractCadenceReplenishmentSweepResult,
  TenantConnectionResolver,
} from '@alga-psa/billing/actions/contractCadenceServicePeriodMaterialization';
