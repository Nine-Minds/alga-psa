import knexFactory, { type Knex } from 'knex';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantDb } from '@alga-psa/db';
import { wireLocalTestDbEnv } from '../../../../server/test-utils/dbConfig';
import { nativeInteractionCandidates } from '../nativeInteractionCandidates';
import { AUTHORIZED_ROW_MAX_WINDOWS, AUTHORIZED_ROW_WINDOW_SIZE, pageAuthorizedRows } from '../pageAuthorizedRows';
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
      interaction_date timestamptz NULL,
      title text NULL
    ) ON COMMIT DROP`);
    await trx('interactions').insert([
      { tenant, interaction_id: 'precision-row-a', interaction_date: '2026-04-01T12:00:00.123456Z', title: 'protected title' },
      { tenant, interaction_id: 'precision-row-b', interaction_date: '2026-04-01T12:00:00.123456Z', title: 'protected title' },
      { tenant, interaction_id: 'precision-row-c', interaction_date: '2026-04-01T12:00:00.123455Z', title: 'protected title' },
      { tenant, interaction_id: 'precision-row-d', interaction_date: '2026-04-01T12:00:00.123001Z', title: 'protected title' },
      { tenant, interaction_id: 'precision-row-e', interaction_date: '2026-04-01T12:00:00.123000Z', title: 'protected title' },
      { tenant, interaction_id: 'precision-row-f', interaction_date: '2026-04-01T12:00:00.122999Z', title: 'protected title' },
    ]);
  });
  afterEach(async () => { await trx.rollback(); });

  it('preserves tied microseconds and sub-millisecond timestamps across SQL windows and encrypted continuations', async () => {
    const readCandidates = (after: { interaction_date_sort_key: string | null; interaction_id: string } | null) =>
      nativeInteractionCandidates(owner(), {}, after, {}, 2);

    const firstWindow = await readCandidates(null);
    expect(firstWindow[0]).not.toHaveProperty('interaction_date');
    expect(firstWindow[0].interaction_date_sort_key).toContain('.123456');
    expect(firstWindow[0]).toEqual({
      interaction_date_sort_key: firstWindow[0].interaction_date_sort_key,
      interaction_id: 'precision-row-a',
    });

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
  it('orders NULL dates last with an id tiebreak and continues across the NULL boundary', async () => {
    await trx('interactions').insert([
      { tenant, interaction_id: 'precision-null-b', interaction_date: null, title: 'x' },
      { tenant, interaction_id: 'precision-null-a', interaction_date: null, title: 'x' },
    ]);
    const ids: string[] = [];
    let after: { interaction_date_sort_key: string | null; interaction_id: string } | null = null;
    while (true) {
      const rows = await nativeInteractionCandidates(owner(), {}, after, {}, 3);
      ids.push(...rows.map(row => row.interaction_id));
      if (rows.length < 3) break;
      const last = rows.at(-1)!;
      after = { interaction_date_sort_key: last.interaction_date_sort_key, interaction_id: last.interaction_id };
    }
    expect(ids).toEqual(['precision-row-a', 'precision-row-b', 'precision-row-c', 'precision-row-d', 'precision-row-e', 'precision-row-f',
      'precision-null-a', 'precision-null-b']);
  });

  it('refuses forged, malformed, cross-tenant and cross-scope continuations', async () => {
    const position = { interaction_id: 'precision-row-a', interaction_date_sort_key: '2026-04-01 12:00:00.123456+00' };
    const token = await sealNativeInteractionCursor(position, tenant, cursorScope);
    await expect(openNativeInteractionCursor(token, tenant, cursorScope)).resolves.toEqual(position);
    await expect(openNativeInteractionCursor(token, 'another-tenant', cursorScope)).rejects.toThrow('Invalid interaction continuation');
    await expect(openNativeInteractionCursor(token, tenant, `${cursorScope}-other`)).rejects.toThrow('Invalid interaction continuation');
    const [version, iv, tag, payload] = token.split('.');
    const flipped = Buffer.from(payload, 'base64url'); flipped[0] ^= 1;
    await expect(openNativeInteractionCursor([version, iv, tag, flipped.toString('base64url')].join('.'), tenant, cursorScope)).rejects.toThrow('Invalid interaction continuation');
    await expect(openNativeInteractionCursor('precision-row-a', tenant, cursorScope)).rejects.toThrow('Invalid interaction continuation');
    await expect(openNativeInteractionCursor(`${token}.extra`, tenant, cursorScope)).rejects.toThrow('Invalid interaction continuation');
  });

  it('issues a bounded number of candidate fetches however many rows exist', async () => {
    await trx.raw(`INSERT INTO interactions (tenant, interaction_id, interaction_date, title)
      SELECT ?, 'bulk-' || lpad(g::text, 6, '0'), '2026-01-01T00:00:00Z'::timestamptz - g * interval '1 second', 'bulk' FROM generate_series(1, 5000) g`, [tenant]);
    let fetches = 0, authorized = 0;
    const result = await pageAuthorizedRows<{ interaction_date_sort_key: string | null; interaction_id: string }, { interaction_date_sort_key: string | null; interaction_id: string }>({
      pageSize: 10, maxWindows: AUTHORIZED_ROW_MAX_WINDOWS,
      fetchCandidates: async (after, limit) => { fetches++; return nativeInteractionCandidates(owner(), {}, after, {}, limit); },
      authorize: async candidate => { authorized++; return candidate; }, matches: () => true,
    });
    expect(result.rows).toHaveLength(10);
    expect(result.exhausted).toBe(false);
    expect(fetches).toBeLessThanOrEqual(AUTHORIZED_ROW_MAX_WINDOWS);
    expect(authorized).toBeLessThanOrEqual(AUTHORIZED_ROW_MAX_WINDOWS * AUTHORIZED_ROW_WINDOW_SIZE);
  });
});
