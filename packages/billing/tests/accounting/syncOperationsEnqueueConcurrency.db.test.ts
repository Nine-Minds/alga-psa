import { describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import knexLib from 'knex';
import { SyncOperationsRepository } from '../../src/services/accountingSync/syncOperationsRepository';
import type { EnqueueSyncOperationInput } from '../../src/services/accountingSync/accountingSync.types';

// Guarded DB test for concurrent enqueue idempotency. A partial unique index
// (accounting_sync_operations_pending_unique) enforces one pending op per
// tenant + adapter + operation + entity + realm. The old SELECT-then-INSERT
// enqueue raced: two concurrent callers both saw no pending row and the loser's
// INSERT threw a unique-constraint error. enqueue() is now INSERT ... ON
// CONFLICT DO NOTHING + reuse, so both concurrent callers resolve to the single
// pending op and neither throws.
//
// Run explicitly against a real Postgres that has the migrations applied:
//   ACCOUNTING_SYNC_DB_TESTS=1 vitest run syncOperationsEnqueueConcurrency
const enabled = process.env.ACCOUNTING_SYNC_DB_TESTS === '1';

const config = {
  host: process.env.ACCOUNTING_SYNC_DB_HOST || '127.0.0.1',
  port: Number(process.env.ACCOUNTING_SYNC_DB_PORT || 6472),
  user: process.env.ACCOUNTING_SYNC_DB_USER || 'app_user',
  password: process.env.ACCOUNTING_SYNC_DB_PASSWORD || '',
  database: process.env.ACCOUNTING_SYNC_DB_NAME || 'server',
};

describe.runIf(enabled)('SyncOperationsRepository.enqueue concurrency', () => {
  it('lets two concurrent callers succeed with exactly one pending operation', async () => {
    // Pool max >= 2 so the two enqueues genuinely run on separate connections
    // and actually contend on the unique index.
    const db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 4 } });
    const tenant = uuidv4();
    const entityId = uuidv4();

    const input: EnqueueSyncOperationInput = {
      tenant,
      adapterType: 'qbo',
      targetRealm: 'realm-A',
      operation: 'void_invoice',
      algaEntityType: 'invoice',
      algaEntityId: entityId,
      payload: { reason: 'concurrency-test' },
    };

    try {
      await db('tenants').insert({
        tenant,
        client_name: 'Enqueue Concurrency Tenant',
        email: 'enqueue-concurrency@test.local',
        billing_source: 'test',
      });

      const repo = new SyncOperationsRepository(db);

      // Fire both enqueues concurrently. If enqueue were not atomic, one of
      // these promises would reject with a unique-constraint violation.
      const [first, second] = await Promise.all([repo.enqueue(input), repo.enqueue(input)]);

      // Both callers get a real pending operation back...
      expect(first.status).toBe('pending');
      expect(second.status).toBe('pending');
      // ...and it is the SAME operation (deduped, not two rows).
      expect(first.op_id).toBe(second.op_id);

      // Exactly one pending row exists for this identity in the database.
      const pendingRows = await db('accounting_sync_operations')
        .where({
          tenant,
          adapter_type: input.adapterType,
          target_realm: input.targetRealm,
          operation: input.operation,
          alga_entity_type: input.algaEntityType,
          alga_entity_id: input.algaEntityId,
          status: 'pending',
        })
        .select('op_id');
      expect(pendingRows).toHaveLength(1);
      expect(pendingRows[0].op_id).toBe(first.op_id);

      // A subsequent enqueue for the same identity keeps reusing the same op.
      const third = await repo.enqueue(input);
      expect(third.op_id).toBe(first.op_id);

      // Realm is part of the identity: a different realm is a distinct op.
      const otherRealm = await repo.enqueue({ ...input, targetRealm: 'realm-B' });
      expect(otherRealm.op_id).not.toBe(first.op_id);
    } finally {
      await db('accounting_sync_operations').where({ tenant }).del();
      await db('tenants').where({ tenant }).del();
      await db.destroy();
    }
  });
});
