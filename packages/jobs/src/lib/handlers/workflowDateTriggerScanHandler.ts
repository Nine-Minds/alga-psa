import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { computeClientAnniversary, computeDateTrigger, DATE_TRIGGER_THRESHOLDS } from '@shared/workflow/streams/domainEventBuilders/clientDateEventBuilders';

export interface WorkflowDateTriggerScanJobData extends Record<string, unknown> { tenantId: string; now?: string; }

export async function workflowDateTriggerScanHandler(data: WorkflowDateTriggerScanJobData): Promise<void> {
  const { knex } = await createTenantKnex(data.tenantId);
  const now = data.now ?? new Date().toISOString();
  const today = now.slice(0, 10);
  // Every query uses tenantDb; anniversary source is clients.created_at.
  const clients = await tenantDb(knex, data.tenantId).table('clients').select('client_id', 'created_at').whereNotNull('created_at');
  for (const client of clients) {
    const anniversary = computeClientAnniversary({ createdAt: client.created_at, now });
    if (!anniversary || !DATE_TRIGGER_THRESHOLDS.includes(anniversary.daysUntil as any)) continue;
    await publishWorkflowEvent({ eventType: 'CLIENT_ANNIVERSARY_UPCOMING', payload: { clientId: client.client_id, ...anniversary }, idempotencyKey: `client-anniversary:${client.client_id}:${anniversary.anniversaryDate}:${anniversary.daysUntil}`, ctx: { tenantId: data.tenantId, occurredAt: now, actor: { actorType: 'SYSTEM' } } });
  }
  const assets = await tenantDb(knex, data.tenantId).table('assets').select('asset_id', 'client_id', 'warranty_end_date').whereNotNull('warranty_end_date');
  for (const asset of assets) {
    const daysUntil = computeDateTrigger(asset.warranty_end_date, now, [30, 7, 0]);
    if (daysUntil === null) continue;
    await publishWorkflowEvent({ eventType: 'ASSET_WARRANTY_EXPIRING', payload: { assetId: asset.asset_id, clientId: asset.client_id ?? undefined, expiresAt: new Date(asset.warranty_end_date).toISOString(), daysUntilExpiry: daysUntil }, idempotencyKey: `asset-warranty:${asset.asset_id}:${String(asset.warranty_end_date).slice(0,10)}:${daysUntil}`, ctx: { tenantId: data.tenantId, occurredAt: now, actor: { actorType: 'SYSTEM' } } });
  }
  const contracts = await tenantDb(knex, data.tenantId).table('client_contracts').select('client_contract_id', 'client_id', 'decision_due_date', 'end_date', 'renewal_cycle_key').where({ is_active: true }).whereNotNull('decision_due_date');
  for (const contract of contracts) {
    const daysUntilDecisionDue = computeDateTrigger(contract.decision_due_date, now);
    if (daysUntilDecisionDue === null) continue;
    const renewalAt = contract.end_date ?? contract.decision_due_date;
    const daysUntilRenewal = Math.max(0, Math.round((Date.parse(`${String(renewalAt).slice(0,10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000));
    await publishWorkflowEvent({ eventType: 'CONTRACT_RENEWAL_UPCOMING', payload: { contractId: contract.client_contract_id, clientId: contract.client_id, renewalAt: String(renewalAt).slice(0,10), daysUntilRenewal, renewalCycleKey: contract.renewal_cycle_key ?? undefined }, idempotencyKey: `contract-renewal:${contract.client_contract_id}:${contract.renewal_cycle_key ?? contract.decision_due_date}:${daysUntilDecisionDue}`, ctx: { tenantId: data.tenantId, occurredAt: now, actor: { actorType: 'SYSTEM' } } });
  }
}
