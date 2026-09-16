import type { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { tenantDb } from '@alga-psa/db';
import type { ISO8601String } from '@alga-psa/types';
import { getConnection } from 'server/src/lib/db/db';
import {
  runContractCadenceReplenishmentForTenant,
  type ContractCadenceReplenishmentSummary,
} from '@alga-psa/billing/actions/contractCadenceServicePeriodMaterialization';

export const CONTRACT_CADENCE_REPLENISHMENT_TENANT_ENUMERATION =
  '__contract_cadence_replenishment_tenant_enumeration__';

export const CONTRACT_CADENCE_REPLENISHMENT_JOB_NAME = 'replenishContractCadenceServicePeriods';

export const CONTRACT_CADENCE_REPLENISHMENT_SOURCE_RUN_PREFIX = 'nightly-contract-cadence-replenishment';

export type TenantConnectionResolver = (tenant: string | null) => Promise<Knex>;

export interface ContractCadenceReplenishmentSweepOptions {
  asOf?: ISO8601String;
  /**
   * Test seam: production resolves a pooled connection per tenant, while
   * DB-backed tests inject the active transaction so the sweep joins the
   * fixture's rollback scope.
   */
  resolveConnection?: TenantConnectionResolver;
  sourceRunPrefix?: string;
}

export interface ContractCadenceReplenishmentSweepResult {
  tenantsProcessed: number;
  tenantsFailed: number;
  summaries: ContractCadenceReplenishmentSummary[];
}

export function summarizeContractCadenceReplenishment(
  summary: ContractCadenceReplenishmentSummary,
): Record<string, unknown> {
  return {
    tenant: summary.tenant,
    linesExamined: summary.linesExamined,
    linesReplenished: summary.linesReplenished,
    periodsGenerated: summary.periodsGenerated,
    periodsRealigned: summary.periodsRealigned,
    periodsSuperseded: summary.periodsSuperseded,
    linesAtPeriodCap: summary.linesAtPeriodCap,
    linesAwaitingCoverage: summary.linesAwaitingCoverage,
    failedObligations: summary.failures.length,
    failures: summary.failures.slice(0, 20),
  };
}

/**
 * Nightly sweep over every non-suspended tenant. Each tenant runs in its own
 * transaction behind a per-tenant advisory lock; one tenant failing never stops
 * the rest, and failures are logged with the tenant and obligation scope so an
 * exhausted or broken schedule is discoverable rather than silently skipped.
 */
export async function replenishContractCadenceServicePeriodsSweep(
  options: ContractCadenceReplenishmentSweepOptions = {},
): Promise<ContractCadenceReplenishmentSweepResult> {
  const resolveConnection: TenantConnectionResolver =
    options.resolveConnection ?? ((tenant: string | null) => getConnection(tenant));
  const sourceRunPrefix =
    options.sourceRunPrefix ?? CONTRACT_CADENCE_REPLENISHMENT_SOURCE_RUN_PREFIX;

  const rootKnex = await resolveConnection(null);
  const tenants = await tenantDb(rootKnex, CONTRACT_CADENCE_REPLENISHMENT_TENANT_ENUMERATION)
    .unscoped(
      'tenants',
      'contract cadence replenishment scheduler enumerates all tenants to run per-tenant jobs',
    )
    .whereNull('suspended_at')
    .select('tenant');

  const result: ContractCadenceReplenishmentSweepResult = {
    tenantsProcessed: 0,
    tenantsFailed: 0,
    summaries: [],
  };

  for (const { tenant } of tenants) {
    try {
      const tenantKnex = await resolveConnection(tenant);
      const summary = await runContractCadenceReplenishmentForTenant(tenantKnex, {
        tenant,
        sourceRunPrefix,
        asOf: options.asOf,
      });
      result.tenantsProcessed += 1;
      result.summaries.push(summary);

      const payload = summarizeContractCadenceReplenishment(summary);
      if (summary.failures.length > 0 || summary.linesAwaitingCoverage > 0 || summary.linesAtPeriodCap > 0) {
        logger.warn(
          'Contract-cadence service-period replenishment completed with unresolved coverage or failures',
          payload,
        );
      } else {
        logger.info('Contract-cadence service-period replenishment completed', payload);
      }
    } catch (error) {
      result.tenantsFailed += 1;
      logger.error(`Error replenishing contract-cadence service periods for tenant ${tenant}:`, error);
    }
  }

  return result;
}
