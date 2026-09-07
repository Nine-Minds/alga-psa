import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { isCoManagedUuid } from './sharedWorkIdentity';
import { prepareCoManagedConversationEvent, type CoManagedEventPublication } from './conversationEventOutbox';
import { coManagedConsumerAllowedForChannel, coManagedConversationEventConsumers, type CoManagedEventConsumer } from './conversationEventConsumerCatalog';
export { coManagedConversationEventConsumers, type CoManagedEventConsumer } from './conversationEventConsumerCatalog';

const TABLE = 'co_management_event_consumers';
/** Transactional effects and their completion mark commit together. A caller
 * must propagate effect errors and use this transaction for every DB write.
 * The event is reconstructed from retained intent/current source, never a
 * cached transport body. Unrelated events return false to their native path. */
export async function consumeCoManagedConversationEvent(db: Knex, event: { id: string; eventType: string; payload?: Record<string, any> }, consumer: CoManagedEventConsumer,
  effect: (trx: Knex.Transaction, publication: CoManagedEventPublication) => Promise<void>): Promise<boolean> {
  const tenant = event.payload?.tenantId;
  if (!isCoManagedUuid(tenant) || !isCoManagedUuid(event.id) || !coManagedConversationEventConsumers(event.eventType).includes(consumer)) return false;
  return withTransaction(db, async trx => {
    const owner = tenantDb(trx, tenant);
    const source = await owner.table('co_management_event_outbox').where('event_id', event.id).forShare().first();
    if (!source) return false;
    if (source.event_type !== event.eventType) throw new Error('Co-managed consumer event identity mismatch');
    const row = await owner.table(TABLE).where({ event_id: event.id, consumer }).forUpdate().first();
    if (!row) throw new Error('Missing co-managed consumer obligation');
    if (row.status !== 'pending') return true;
    const publication = source.status === 'cancelled' || !coManagedConsumerAllowedForChannel(source.publication?.channel, consumer) ? null : await prepareCoManagedConversationEvent({ trx, tenant }, source);
    if (publication) await effect(trx, publication);
    await owner.table(TABLE).where({ event_id: event.id, consumer }).update({ status: publication ? 'completed' : 'cancelled', completed_at: trx.raw('clock_timestamp()'), error_code: null });
    return true;
  });
}
/** Targeted replay does not re-run completed sibling consumers or workflows.
 * Sending is not completion: the obligation stays pending until its consumer
 * commits. Redis loss, consumer crashes, and trimmed streams are recoverable. */
export async function recoverCoManagedEventConsumers(db: Knex, tenant: string,
  publish: (publication: CoManagedEventPublication, eventId: string, consumer: CoManagedEventConsumer) => Promise<void>, options: { limit?: number } = {}) {
  const limit = options.limit ?? 30;
  if (db.isTransaction || !isCoManagedUuid(tenant) || !Number.isInteger(limit) || limit < 1 || limit > 300) throw new Error('Invalid co-managed consumer recovery');
  const result = { queued: 0, cancelled: 0, failed: 0 };
  const owner = tenantDb(db, tenant), candidates = owner.table(`${TABLE} as c`);
  owner.tenantJoin(candidates, 'co_management_event_outbox as e', 'c.event_id', 'e.event_id');
  const items = await candidates.where('c.status', 'pending').whereNot('e.status', 'pending').where('c.next_attempt_at', '<=', db.raw('clock_timestamp()'))
    .orderBy('c.next_attempt_at').orderBy('c.event_id').orderBy('c.consumer').limit(limit).select('c.event_id', 'c.consumer');
  for (const item of items) {
    try {
      const outcome = await db.transaction(async trx => {
        const owner = tenantDb(trx, tenant);
        const source = await owner.table('co_management_event_outbox').where('event_id', item.event_id).forShare().first();
        if (!source || source.status === 'pending') return null;
        const row = await owner.table(TABLE).where({ ...item, status: 'pending' }).where('next_attempt_at', '<=', trx.raw('clock_timestamp()')).forUpdate().skipLocked().first();
        if (!row) return null;
        const publication = source.status === 'cancelled' || !coManagedConsumerAllowedForChannel(source.publication?.channel, item.consumer) ? null : await prepareCoManagedConversationEvent({ trx, tenant }, source);
        if (!publication) {
          await owner.table(TABLE).where(item).update({ status: 'cancelled', completed_at: trx.raw('clock_timestamp()'), error_code: null });
          return 'cancelled';
        }
        await publish(publication, row.event_id, row.consumer);
        await defer(owner.table(TABLE).where(item), trx, null);
        return 'queued';
      });
      if (outcome) result[outcome]++;
    } catch {
      result.failed++;
      await defer(tenantDb(db, tenant).table(TABLE).where({ ...item, status: 'pending' }), db, 'consumer_replay_failed');
    }
  }
  return result;
}
function defer(query: Knex.QueryBuilder, db: Knex, errorCode: string | null) {
  return query.update({ attempts: db.raw('attempts + 1'), error_code: errorCode,
    next_attempt_at: db.raw("clock_timestamp() + least(3600, power(2, least(attempts, 10)) * 120) * interval '1 second'") });
}
