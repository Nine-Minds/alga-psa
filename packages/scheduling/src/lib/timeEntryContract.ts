import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { CONTRACT_LINE_SOURCE_BY_SELECTION_REASON, type ContractLineSource } from '@alga-psa/types';
import { loadEligibleTimeContractLines } from './timeContractCandidates';
import { resolveDeterministicContractLineSelection } from './contractLineDisambiguation.shared';
import { getTimeEntryWorkBillingContext } from '@alga-psa/shared/billingClients/timeEntryWorkBillingContext';

export class TimeEntryContractError extends Error {
  constructor(readonly code: 'TIME_SERVICE_UNAVAILABLE' | 'TIME_CONTRACT_UNAVAILABLE') {
    super(code === 'TIME_SERVICE_UNAVAILABLE' ? 'A current local service is required for time entry' : 'The selected contract line does not cover this client and service');
    this.name = 'TimeEntryContractError';
  }
}

/** Native and API writers resolve local commercial fields in the same retained
 * transaction. No current-user lookup or second database connection is needed. */
export async function resolveTimeEntryContract(trx: Knex.Transaction, tenant: string,
  entry: { work_item_id?: string | null; work_item_type: string; service_id?: string | null; work_date?: string; start_time: string | Date },
  options: { explicitLineId?: string | null; preferredLineId?: string | null; preferredSource?: ContractLineSource | null } = {}) {
  if (!trx.isTransaction) throw new Error('Time contract selection requires its owning transaction');
  const service = entry.service_id ? await tenantDb(trx, tenant).table('service_catalog').where('service_id', entry.service_id).forShare().first('service_id') : null;
  if (!service) throw new TimeEntryContractError('TIME_SERVICE_UNAVAILABLE');
  const context = entry.work_item_id ? await getTimeEntryWorkBillingContext(trx, tenant, entry.work_item_id, entry.work_item_type) : null;
  const candidates = context ? await loadEligibleTimeContractLines(trx, tenant, context.clientId, service.service_id, entry.work_date || entry.start_time, true) : [];
  if (options.explicitLineId) {
    if (!candidates.some(line => line.client_contract_line_id === options.explicitLineId)) throw new TimeEntryContractError('TIME_CONTRACT_UNAVAILABLE');
    return { contract_line_id: options.explicitLineId, contract_line_source: 'explicit' as ContractLineSource };
  }
  if (options.preferredLineId && candidates.some(line => line.client_contract_line_id === options.preferredLineId)) {
    return { contract_line_id: options.preferredLineId, contract_line_source: options.preferredSource ?? 'explicit' };
  }
  const selected = resolveDeterministicContractLineSelection(candidates, { billingProfileId: context?.billingProfileId });
  return { contract_line_id: selected.selectedContractLineId, contract_line_source: CONTRACT_LINE_SOURCE_BY_SELECTION_REASON[selected.reason] };
}
