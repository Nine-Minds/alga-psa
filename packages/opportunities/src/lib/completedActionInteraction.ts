import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IOpportunity } from '@alga-psa/types';
import { OpportunityModel } from '../models/opportunityModel';

interface CompletedActionInteractionInput {
  opportunity: Pick<IOpportunity, 'opportunity_id' | 'client_id' | 'contact_id'>;
  completedAction: string;
  actorUserId: string;
  occurredAt: string;
}

export async function recordCompletedActionInteraction(
  trx: Knex.Transaction,
  tenant: string,
  input: CompletedActionInteractionInput,
): Promise<void> {
  const db = tenantDb(trx, tenant);
  const noteType = await db.table('system_interaction_types')
    .where({ type_name: 'Note' })
    .select('type_id')
    .first();

  if (!noteType) {
    throw new Error('System interaction type Note missing');
  }

  await db.table('interactions').insert({
    tenant,
    type_id: noteType.type_id,
    contact_name_id: input.opportunity.contact_id ?? null,
    client_id: input.opportunity.client_id,
    opportunity_id: input.opportunity.opportunity_id,
    user_id: input.actorUserId,
    title: `Completed next action: ${input.completedAction}`,
    notes: input.completedAction,
    interaction_date: input.occurredAt,
    start_time: input.occurredAt,
    end_time: input.occurredAt,
    duration: 0,
    status_id: null,
    visibility: 'internal',
    category: 'opportunity_action',
  });
}

export async function completeOpportunityNextAction(
  trx: Knex.Transaction,
  tenant: string,
  opportunityId: string,
  nextAction: { next_action: string; next_action_due: string },
  actorUserId: string,
): Promise<IOpportunity> {
  const current = await OpportunityModel.getById(trx, tenant, opportunityId);
  if (!current) throw new Error('Opportunity not found');
  if (current.status !== 'open') throw new Error('Only open opportunities have next actions');

  const completedAction = current.next_action?.trim();
  if (!completedAction) throw new Error('Opportunity has no current next action to complete');

  const now = new Date().toISOString();
  await recordCompletedActionInteraction(trx, tenant, {
    opportunity: current,
    completedAction,
    actorUserId,
    occurredAt: now,
  });

  return OpportunityModel.update(trx, tenant, opportunityId, {
    ...nextAction,
    last_activity_at: now,
    overdue_notified_at: null,
  });
}
