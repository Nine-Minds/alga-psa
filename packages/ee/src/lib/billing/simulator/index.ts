/**
 * CE stub for @enterprise/lib/billing/simulator. The contract simulator is an
 * Enterprise feature; callers must guard with isEnterpriseBuild() before
 * invoking these (see packages/billing/src/actions/contractSimulationActions.ts).
 */

import type { Knex } from 'knex';
import type {
  ContractDraftSimulationInput,
  ContractScenario,
  ContractSimulationResult,
  ISO8601String,
  ScenarioAssumptionPrefill,
} from '@alga-psa/types';

export async function snapshotContractToScenario(
  _knex: Knex,
  _tenant: string,
  _params: { contractId: string; clientContractId: string | null; clientId?: string | null; forceProfile?: boolean }
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

export async function draftContractToScenario(
  _knex: Knex,
  _tenant: string,
  _draft: ContractDraftSimulationInput,
): Promise<ContractScenario> {
  throw new Error('Contract simulator is only available in Enterprise Edition');
}

export async function loadRecentAverageAssumptions(
  _knex: Knex,
  _tenant: string,
  _scenario: ContractScenario,
  _periodCount = 3,
): Promise<ScenarioAssumptionPrefill> {
  throw new Error('Contract simulator is only available in Enterprise Edition');
}

export async function loadReplayAssumptions(
  _knex: Knex,
  _tenant: string,
  _scenario: ContractScenario,
  _startDate: ISO8601String,
  _endDateExclusive: ISO8601String,
): Promise<ScenarioAssumptionPrefill> {
  throw new Error('Contract simulator is only available in Enterprise Edition');
}
