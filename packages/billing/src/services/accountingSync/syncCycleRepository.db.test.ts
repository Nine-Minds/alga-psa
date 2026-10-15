import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../actions/_dbTestUtils';
import { SyncCycleRepository } from './syncCycleRepository';

const tenantId = uuidv4();
let db: Knex;

beforeAll(async () => {
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  await db('tenants').insert({
    tenant: tenantId,
    client_name: 'Cursor Test',
    email: `cursor-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
});

afterAll(async () => {
  await db('accounting_sync_cycles').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
  await db.destroy().catch(() => undefined);
});

describe('SyncCycleRepository resume cursor', () => {
  it('falls back to the most recent cycle cursor_before when nothing has succeeded', async () => {
    const realm = 'cursor-realm-failed';
    await db('accounting_sync_cycles').insert({
      tenant: tenantId,
      adapter_type: 'xero',
      target_realm: realm,
      status: 'failed',
      cursor_before: '2026-01-01T00:00:00.000Z',
      cursor_after: null,
      started_at: '2026-01-02T00:00:00.000Z',
    });

    const repo = new SyncCycleRepository(db);
    const result = await repo.getLastSuccessfulCursor(tenantId, 'xero', realm);
    expect(new Date(result!).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('prefers a succeeded cursor_after over an earlier failed boundary', async () => {
    const realm = 'cursor-realm-success';
    await db('accounting_sync_cycles').insert([
      {
        tenant: tenantId,
        adapter_type: 'xero',
        target_realm: realm,
        status: 'failed',
        cursor_before: '2026-01-01T00:00:00.000Z',
        cursor_after: null,
        started_at: '2026-01-02T00:00:00.000Z',
      },
      {
        tenant: tenantId,
        adapter_type: 'xero',
        target_realm: realm,
        status: 'succeeded',
        cursor_before: '2026-01-01T00:00:00.000Z',
        cursor_after: '2026-01-05T00:00:00.000Z',
        started_at: '2026-01-06T00:00:00.000Z',
      },
    ]);

    const repo = new SyncCycleRepository(db);
    const result = await repo.getLastSuccessfulCursor(tenantId, 'xero', realm);
    expect(new Date(result!).toISOString()).toBe('2026-01-05T00:00:00.000Z');
  });
});
