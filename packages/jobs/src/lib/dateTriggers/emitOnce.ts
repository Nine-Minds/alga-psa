import type { Knex } from 'knex';
import { v5 as uuidv5 } from 'uuid';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { tenantDb } from '@alga-psa/db';
import type { WorkflowEventPublishContext } from '@alga-psa/event-bus/workflow/workflowEventPublishHelpers';

const EVENT_ID_NAMESPACE = '4e2f55ec-8a63-5e7b-ae61-745387c70d42';

export async function emitDateDomainEventOnce(knex: Knex, tenant: string, params: {
  eventType: string; entityId: string; cycleKey: string; occursOn: string; payload: Record<string, unknown>; ctx?: WorkflowEventPublishContext;
}): Promise<boolean> {
  const dedupeKey = `event:${params.eventType}:${params.entityId}:${params.cycleKey}`;
  const inserted = await tenantDb(knex, tenant).table('date_trigger_emissions').insert({
    tenant, dedupe_key: dedupeKey, event_type: params.eventType, entity_id: params.entityId, occurs_on: params.occursOn,
  }).onConflict(['tenant', 'dedupe_key']).ignore().returning('dedupe_key');
  if (inserted.length === 0) return false;
  await publishWorkflowEvent({
    eventType: params.eventType as never,
    payload: params.payload,
    ctx: params.ctx ?? { tenantId: tenant, actor: { actorType: 'SYSTEM' } },
  }, { eventId: uuidv5(dedupeKey, EVENT_ID_NAMESPACE) });
  return true;
}
