import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { DateTriggerSource } from '../types';

export const contractEndSource: DateTriggerSource = {
  id: 'contract.end', payloadSchemaRef: 'payload.ContractEndDate.v1',
  async findOccurrences(knex: Knex, tenant: string, fromDate: string, toDate: string) {
    // LEVERAGE: Keep contract date sources on this tenant-scoped client-contract join shape.
    const rows = await tenantDb(knex, tenant).table('client_contracts as cc').join('clients as c', function joinClient() { this.on('c.client_id', '=', 'cc.client_id').andOn('c.tenant', '=', 'cc.tenant'); })
      .select('cc.client_contract_id', 'cc.contract_id', 'cc.client_id', 'c.client_name')
      .select(knex.raw('cc.end_date::text as end_date'))
      .where('cc.is_active', true).whereNotNull('cc.end_date').whereBetween('cc.end_date', [fromDate, toDate]);
    return rows.map((r) => ({ entityId: r.client_contract_id, clientId: r.client_id, occursOn: String(r.end_date).slice(0, 10), cycleKey: String(r.end_date).slice(0, 10), payload: { contractId: r.contract_id, clientContractId: r.client_contract_id, clientId: r.client_id, clientName: r.client_name, occursOn: String(r.end_date).slice(0, 10), endDate: String(r.end_date).slice(0, 10) } }));
  },
};
