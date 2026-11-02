import knexFactory, { type Knex } from 'knex';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantDb } from '@alga-psa/db';
import { wireLocalTestDbEnv } from '../../../../server/test-utils/dbConfig';
import { nativeInteractionCandidates } from '../nativeInteractionCandidates';
import { openNativeInteractionCursor, sealNativeInteractionCursor } from '../nativeInteractionCursor';

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: async (_name: string, envVar: string) => process.env[envVar] || 'test-interaction-cursor-secret',
}));

wireLocalTestDbEnv();
const { describeWithDb } = await import('../../../../server/test-utils/requireDb');
const describeDb = await describeWithDb();
const tenant = 'interaction-precision-test';
const cursorScope = 'postgres-timestamptz-precision-regression';
let db: Knex;
let trx: Knex.Transaction;
const owner = () => ({ table: (table: string) => trx(table).where('tenant', tenant) }) as unknown as TenantDb;

describeDb('native interaction candidate PostgreSQL timestamp precision', () => {
  beforeAll(async () => {
    db = knexFactory({
      client: 'pg',
      connection: {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        database: process.env.TEST_DB_NAME || 'test_database',
        user: process.env.DB_USER_SERVER,
        password: process.env.DB_PASSWORD_SERVER,
      },
      pool: { min: 0, max: 1 },
    });
    await db.raw('select 1');
  });
  afterAll(async () => { await db?.destroy(); });
  beforeEach(async () => {
    trx = await db.transaction();
    await trx.raw(`CREATE TEMP TABLE interactions (
      tenant text NOT NULL,
      interaction_id text NOT NULL,
      interaction_date timestamptz NULL
    ) ON COMMIT DROP`);
    await trx('interactions').insert([
      { tenant, interaction_id: 'precision-row-a', interaction_date: '2026-04-01T12:00:00.123456Z' },
      { tenant, interaction_id: 'precision-row-b', interaction_date: '2026-04-01T12:00:00.123456Z' },
      { tenant, interaction_id: 'precision-row-c', interaction_date: '2026-04-01T12:00:00.123455Z' },
      { tenant, interaction_id: 'precision-row-d', interaction_date: '2026-04-01T12:00:00.123001Z' },
      { tenant, interaction_id: 'precision-row-e', interaction_date: '2026-04-01T12:00:00.123000Z' },
      { tenant, interaction_id: 'precision-row-f', interaction_date: '2026-04-01T12:00:00.122999Z' },
    ]);
  });
  afterEach(async () => { await trx.rollback(); });

  it('preserves tied microseconds and sub-millisecond timestamps across SQL windows and encrypted continuations', async () => {
    const readCandidates = (after: { interaction_date_sort_key: string | null; interaction_id: string } | null) =>
      nativeInteractionCandidates(owner(), {}, after, {}, 2);

    const firstWindow = await readCandidates(null);
    expect(firstWindow[0].interaction_date).toBeInstanceOf(Date);
    expect(firstWindow[0].interaction_date.toISOString()).toContain('.123Z');
    expect(firstWindow[0].interaction_date_sort_key).toContain('.123456');

    const windowIds: string[] = [];
    let after: { interaction_date_sort_key: string | null; interaction_id: string } | null = null;
    while (true) {
      const rows = await readCandidates(after);
      windowIds.push(...rows.map(row => row.interaction_id));
      if (rows.length < 2) break;
      const last = rows.at(-1)!;
      after = { interaction_date_sort_key: last.interaction_date_sort_key, interaction_id: last.interaction_id };
    }
    expect(windowIds).toEqual(['precision-row-a', 'precision-row-b', 'precision-row-c', 'precision-row-d', 'precision-row-e', 'precision-row-f']);

    const continuedIds: string[] = [];
    let continuation: string | null = null;
    while (true) {
      const position = continuation ? await openNativeInteractionCursor(continuation, tenant, cursorScope) : null;
      const rows = await readCandidates(position);
      continuedIds.push(...rows.map(row => row.interaction_id));
      if (rows.length < 2) break;
      const last = rows.at(-1)!;
      continuation = await sealNativeInteractionCursor({
        interaction_id: last.interaction_id,
        interaction_date_sort_key: last.interaction_date_sort_key,
      }, tenant, cursorScope);
      expect(continuation).not.toContain(last.interaction_id);
      expect(continuation).not.toContain(last.interaction_date_sort_key);
    }
    expect(continuedIds).toEqual(['precision-row-a', 'precision-row-b', 'precision-row-c', 'precision-row-d', 'precision-row-e', 'precision-row-f']);
    expect(new Set(continuedIds).size).toBe(6);
  });
});
