import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IOpportunity } from '@alga-psa/types';

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
