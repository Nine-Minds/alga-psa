'use server';

import logger from '@alga-psa/core/logger';
import type {
  ContractScenario,
  ContractSimulationResult,
  ContractSimulationUnavailable,
} from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';

function isEnterpriseBuild(): boolean {
  return process.env.EDITION === 'ee' || process.env.NEXT_PUBLIC_EDITION === 'enterprise';
}

const UNAVAILABLE: ContractSimulationUnavailable = {
  available: false,
  reason: 'not_enterprise',
};

async function loadEnterpriseSimulator(): Promise<{
  snapshotContractToScenario: any;
  simulateContractScenario: any;
} | null> {
  if (!isEnterpriseBuild()) return null;
  try {
    const mod = await import('@enterprise/lib/billing/simulator');
    return {
      snapshotContractToScenario: (mod as any).snapshotContractToScenario,
      simulateContractScenario: (mod as any).simulateContractScenario,
    };
  } catch (error) {
    logger.debug('[billing/contractSimulationActions] enterprise simulator module not available', {
      error,
    });
    return null;
  }
}

/**
 * Load a live contract's full billing configuration into an in-memory
 * scenario the simulator workspace can mutate freely. EE only; CE builds
 * receive a structured feature-unavailable result.
 */
export const getContractScenarioSnapshot = withAuth(
  async (
    user,
    { tenant },
    contractId: string,
    clientContractId?: string | null
  ): Promise<ContractScenario | ContractSimulationUnavailable> => {
    if (!(await hasPermission(user, 'billing', 'read'))) {
      throw new Error('Permission denied: Cannot read billing');
    }

    const ee = await loadEnterpriseSimulator();
    if (!ee?.snapshotContractToScenario) return UNAVAILABLE;

    const { knex } = await createTenantKnex();
    return ee.snapshotContractToScenario(knex, tenant, {
      contractId,
      clientContractId: clientContractId ?? null,
    });
  }
);

/**
 * Price a scenario through the shared pure billing compute layer over its
 * horizon. Strictly read-only against the database — no billing rows are
 * created, updated, or deleted by a simulation run.
 */
export const runContractSimulation = withAuth(
  async (
    user,
    { tenant },
    scenario: ContractScenario
  ): Promise<ContractSimulationResult | ContractSimulationUnavailable> => {
    if (!(await hasPermission(user, 'billing', 'read'))) {
      throw new Error('Permission denied: Cannot read billing');
    }

    const ee = await loadEnterpriseSimulator();
    if (!ee?.simulateContractScenario) return UNAVAILABLE;

    const { knex } = await createTenantKnex();
    return ee.simulateContractScenario(knex, tenant, scenario);
  }
);
