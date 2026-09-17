/**
 * Stable job-name contract for recurring billing jobs that run on more than one
 * backend. This module must stay dependency-free: the Temporal worker's schedule
 * setup imports it to name the maintenance fan-out schedule, and the worker
 * cannot load the billing domain graph.
 */

/**
 * Nightly contract-cadence service-period replenishment. Scheduled as a global
 * Temporal maintenance fan-out on Enterprise/Essentials/Pro deployments and as
 * a per-install pg-boss recurring job on other supported deployments.
 */
export const CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME =
  'replenishContractCadenceServicePeriods';
