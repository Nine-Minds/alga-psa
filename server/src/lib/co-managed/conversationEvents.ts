import type { Knex } from 'knex';
import { registerAfterCommitWithConnection } from '@alga-psa/db';
import { enqueueCoManagedConversationEvent, dispatchCoManagedConversationEvents, type CoManagedEventIntent } from '@alga-psa/co-managed';
import { publishCoManagedConversationEvent } from '@alga-psa/jobs/handlers/coManagedConversationEventPublication';
/** Intent commits with the mutation. Immediate delivery is an optimization;
 * maintenance can recover it even if the process dies before this hook runs. */
export async function queueCoManagedConversationEvent(trx: Knex.Transaction, input: CoManagedEventIntent) {
  await enqueueCoManagedConversationEvent(trx, input);
  const tenant = input.tenant, eventId = input.eventId;
  registerAfterCommitWithConnection(trx, async root => {
    if (root) await dispatchCoManagedConversationEvents(root, tenant, publishCoManagedConversationEvent, { eventId });
  }, `${input.publication.eventType} durable event=${eventId}`);
}
