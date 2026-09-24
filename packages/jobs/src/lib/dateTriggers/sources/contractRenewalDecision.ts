import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { DateTriggerSource } from '../types';
import { buildContractRenewalUpcomingPayload } from '@alga-psa/workflow-streams';

export const contractRenewalDecisionSource: DateTriggerSource = {
  id: 'contract.renewal_decision', payloadSchemaRef: 'payload.ContractRenewalDate.v1',
  domainEvent: { eventType: 'CONTRACT_RENEWAL_UPCOMING', windowDays: 90, buildPayload: (occurrence, daysUntil) => buildContractRenewalUpcomingPayload({ contractId: String(occurrence.payload.contractId), clientId: occurrence.clientId, renewalAt: String(occurrence.payload.endDate ?? occurrence.occursOn), decisionDueDate: occurrence.occursOn, daysUntilRenewal: daysUntil, daysUntilDecisionDue: daysUntil, renewalCycleKey: occurrence.cycleKey }) },
  async findOccurrences(knex: Knex, tenant: string, fromDate: string, toDate: string) {
    const rows = await tenantDb(knex, tenant).table('client_contracts as cc').join('clients as c', function joinClient() { this.on('c.client_id', '=', 'cc.client_id').andOn('c.tenant', '=', 'cc.tenant'); })
      .select('cc.client_contract_id', 'cc.contract_id', 'cc.client_id', 'cc.renewal_cycle_key', 'cc.renewal_mode', 'c.client_name')
      .select(knex.raw('cc.decision_due_date::text as decision_due_date, cc.end_date::text as end_date'))
      .where('cc.is_active', true).whereNotNull('cc.decision_due_date').whereBetween('cc.decision_due_date', [fromDate, toDate]).whereNot('cc.renewal_mode', 'none');
    return rows.map((r) => ({ entityId: r.client_contract_id, clientId: r.client_id, occursOn: String(r.decision_due_date).slice(0, 10), cycleKey: r.renewal_cycle_key ?? String(r.decision_due_date), payload: { contractId: r.contract_id, clientContractId: r.client_contract_id, clientId: r.client_id, clientName: r.client_name, occursOn: String(r.decision_due_date).slice(0, 10), decisionDueDate: String(r.decision_due_date).slice(0, 10), endDate: r.end_date || undefined, renewalMode: r.renewal_mode, renewalCycleKey: r.renewal_cycle_key ?? undefined } }));
  },
};
