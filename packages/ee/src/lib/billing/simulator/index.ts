/**
 * CE stub for @enterprise/lib/billing/simulator. The contract simulator is an
 * Enterprise feature; callers must guard with isEnterpriseBuild() before
 * invoking these (see packages/billing/src/actions/contractSimulationActions.ts).
 */

import type { Knex } from 'knex';
import type { ContractScenario, ContractSimulationResult } from '@alga-psa/types';

export async function snapshotContractToScenario(
  _knex: Knex,
  _tenant: string,
  _params: { contractId: string; clientContractId: string | null }
): Promise<ContractScenario> {
  throw new Error('Contract simulator is only available in Enterprise Edition');
}

export async function simulateContractScenario(
  _knex: Knex,
  _tenant: string,
  _scenario: ContractScenario
): Promise<ContractSimulationResult> {
  throw new Error('Contract simulator is only available in Enterprise Edition');
}
