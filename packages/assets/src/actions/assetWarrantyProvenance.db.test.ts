/**
 * C5 T023 (real DB): asset provenance for an asset with no service and no stock unit still returns its RMA
 * history; rma_number is reported separately from the vendor rma_reference.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';

const holder: { knex: Knex; tenant: string; userId: string; grants: Set<string> | null } = {
  knex: undefined as never, tenant: '', userId: '', grants: null,
};

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: (...a: any[]) => unknown) => (...args: unknown[]) =>
    fn({ user_id: holder.userId, tenant: holder.tenant }, { tenant: holder.tenant }, ...args),
  hasPermission: async (_u: unknown, resource: string, action: string) => holder.grants === null || holder.grants.has(`${resource}:${action}`),
}));
vi.mock('@alga-psa/db', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createTenantKnex: async () => ({ knex: holder.knex, tenant: holder.tenant }),
  withTransaction: (db: Knex, fn: (trx: Knex.Transaction) => Promise<unknown>) => db.transaction(fn),
}));

import { getAssetInventoryProvenance } from './assetInventoryActions';

function connection(): Knex.PgConnectionConfig {
  const database = process.env.TEST_DB_NAME;
  const user = process.env.DB_USER_ADMIN;
  const password = process.env.DB_PASSWORD_ADMIN;
  if (process.env.REQUIRE_DB !== '1' || !database || !user || !password || !/(^|_)(test|tests|regression)(_|$)/i.test(database)) {
    throw new Error('Asset DB tests require REQUIRE_DB=1, a disposable TEST_DB_NAME and admin credentials');
  }
  return { host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432), user, password, database };
}

let knex: Knex;
let CLIENT: string;

beforeAll(async () => {
  knex = knexLib({ client: 'pg', connection: connection(), pool: { min: 1, max: 3 } });
  holder.knex = knex;
  holder.tenant = randomUUID();
  holder.userId = randomUUID();
  CLIENT = randomUUID();
  await knex('tenants').insert({ tenant: holder.tenant, client_name: `Asset provenance ${holder.tenant}`, email: `ap-${holder.tenant}@example.invalid`, product_code: 'psa' });
  await knex('users').insert({ tenant: holder.tenant, user_id: holder.userId, username: `ap-${holder.tenant}`, email: `ap-u-${holder.tenant}@example.invalid`, hashed_password: 'x', user_type: 'internal', first_name: 'A', last_name: 'P' });
  await knex('clients').insert({ tenant: holder.tenant, client_id: CLIENT, client_name: 'Provenance customer', billing_cycle: 'monthly', billing_email: `b-${holder.tenant}@example.invalid` });
});
afterAll(async () => { await knex?.destroy(); });

describe('T023 getAssetInventoryProvenance for an asset with no service or stock unit', () => {
  it('returns RMA history newest first with rma_number (not the vendor reference); all-null for other assets', async () => {
    const assetId = randomUUID();
    await knex('assets').insert({
      tenant: holder.tenant, asset_id: assetId, asset_type: 'unknown', client_id: CLIENT, asset_tag: `AP-${assetId.slice(0, 8)}`,
      name: 'Dell WD19 dock', serial_number: 'S1', status: 'active', location: '',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const older = randomUUID();
    const newer = randomUUID();
    await knex('rma_cases').insert([
      { tenant: holder.tenant, rma_id: older, rma_number: 'RMA-100', rma_reference: 'DELL-OLD', asset_id: assetId, status: 'closed', created_at: '2026-01-01T00:00:00Z' },
      { tenant: holder.tenant, rma_id: newer, rma_number: 'RMA-200', rma_reference: 'DELL-NEW', asset_id: assetId, status: 'awaiting_return', created_at: '2026-06-01T00:00:00Z' },
    ]);

    const prov = await getAssetInventoryProvenance(assetId);
    expect(prov).toMatchObject({ service_id: null, unit_id: null, sku: null, origin_so_id: null });
    expect(prov.rma_history.map((r) => r.rma_id)).toEqual([newer, older]);
    expect(prov.rma_history.map((r) => r.rma_number)).toEqual(['RMA-200', 'RMA-100']);
    expect(prov.rma_history.map((r) => r.status)).toEqual(['awaiting_return', 'closed']);
    // The vendor reference never appears in the history row, and never replaces the rma_number.
    expect(JSON.stringify(prov.rma_history)).not.toContain('DELL-');
    expect(prov.rma_history.every((r) => !('rma_reference' in r))).toBe(true);

    // an asset with no claims: empty history; a missing asset: all-null
    const bare = randomUUID();
    await knex('assets').insert({
      tenant: holder.tenant, asset_id: bare, asset_type: 'unknown', client_id: CLIENT, asset_tag: `AP-${bare.slice(0, 8)}`,
      name: 'Bare', serial_number: 'S2', status: 'active', location: '',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    expect((await getAssetInventoryProvenance(bare)).rma_history).toEqual([]);
    expect((await getAssetInventoryProvenance(randomUUID())).rma_history).toEqual([]);

    // without asset:read nothing leaks
    holder.grants = new Set(['inventory:read']);
    expect((await getAssetInventoryProvenance(assetId)).rma_history).toEqual([]);
    holder.grants = null;
  });
});
