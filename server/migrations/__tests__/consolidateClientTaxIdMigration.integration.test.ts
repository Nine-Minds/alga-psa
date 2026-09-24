import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '../20260923090000_consolidate_client_tax_id.cjs'));
let db: Knex; let tenant: string; let otherTenant: string; let ids: string[]; let otherClientId: string;
beforeAll(async () => {
  wireLocalTestDbEnv();
  // The wired dev DB already records migrations missing from this branch, so bootstrap/recreate cannot be used.
  db = await createTestDbConnection({ databaseName: 'server', recreate: false, allowProtectedDatabaseForTest: true });
  tenant = randomUUID(); otherTenant = randomUUID(); ids = Array.from({ length: 11 }, () => randomUUID()); otherClientId = randomUUID();
  await db('tenants').insert({ tenant, client_name: `Tax migration ${tenant}`, email: `tax-${tenant}@example.com`, created_at: db.fn.now(), updated_at: db.fn.now() });
  await db('tenants').insert({ tenant: otherTenant, client_name: `Tax migration ${otherTenant}`, email: `tax-${otherTenant}@example.com`, created_at: db.fn.now(), updated_at: db.fn.now() });
  await db('clients').insert(ids.map((client_id, i) => ({ tenant, client_id, client_name: `Tax ${i}`, is_inactive: false, tax_id_number: i === 1 || i === 3 ? 'CANONICAL' : i === 4 ? '  SAME  ' : i === 5 ? 'CANONICAL' : i === 10 ? '   ' : null, properties: i === 0 ? { tax_id: ' BACKFILL ' } : i === 1 ? { tax_id: 'LEGACY' } : i === 2 ? { tax_id: '   ' } : i === 3 ? { legacy_tax_id: 'OLDER-AUDIT', tax_id: ' NEW-LEGACY ' } : i === 4 ? { tax_id: 'SAME' } : i === 5 ? { legacy_tax_id: ['OLDER-AUDIT', 'PRIOR-CONFLICT'], tax_id: ' NEW-LEGACY ' } : i === 6 ? { tax_id: null } : i === 7 ? null : undefined, created_at: db.fn.now(), updated_at: db.fn.now() })));
  await db('clients').where({ tenant }).where({ client_id: ids[9] }).update({ properties: db.raw('NULL') });
  await db('clients').insert({ tenant: otherTenant, client_id: otherClientId, client_name: 'Other tenant', is_inactive: false, tax_id_number: null, properties: { tax_id: 'OTHER-TENANT' }, created_at: db.fn.now(), updated_at: db.fn.now() });
}, 300_000);
afterAll(async () => { if (!db) return; await db('clients').whereIn('tenant', [tenant, otherTenant]).del(); await db('tenants').whereIn('tenant', [tenant, otherTenant]).del(); await db.destroy().catch(() => undefined); });
describe('consolidate client tax ID migration', () => {
  it('backfills, preserves conflicts, removes the old key, and is idempotent', async () => {
    await migration.consolidateTenant(db, tenant);
    const rows = await db('clients').where({ tenant }).whereIn('client_id', ids).select('client_id', 'tax_id_number', 'properties');
    const byId = new Map(rows.map((row: any) => [row.client_id, row]));
    expect(byId.get(ids[0])).toMatchObject({ tax_id_number: 'BACKFILL', properties: {} });
    expect(byId.get(ids[1])).toMatchObject({ tax_id_number: 'CANONICAL', properties: { legacy_tax_id: 'LEGACY' } });
    expect(byId.get(ids[2])).toMatchObject({ properties: {} });
    expect(byId.get(ids[3])).toMatchObject({ tax_id_number: 'CANONICAL', properties: { legacy_tax_id: ['OLDER-AUDIT', 'NEW-LEGACY'] } });
    expect(byId.get(ids[4])).toMatchObject({ tax_id_number: '  SAME  ', properties: {} });
    expect(byId.get(ids[5])).toMatchObject({ tax_id_number: 'CANONICAL', properties: { legacy_tax_id: ['OLDER-AUDIT', 'PRIOR-CONFLICT', 'NEW-LEGACY'] } });
    expect(byId.get(ids[6])).toMatchObject({ tax_id_number: null, properties: {} });
    expect(byId.get(ids[7]).properties).toBeNull();
    expect(byId.get(ids[8]).properties).toBeNull();
    expect(byId.get(ids[9]).properties).toBeNull();
    expect(byId.get(ids[10])).toMatchObject({ tax_id_number: '   ', properties: {} });
    const other = await db('clients').where({ tenant: otherTenant, client_id: otherClientId }).first();
    expect(other).toMatchObject({ tax_id_number: null, properties: { tax_id: 'OTHER-TENANT' } });
    await migration.consolidateTenant(db, otherTenant);
    const otherAfter = await db('clients').where({ tenant: otherTenant, client_id: otherClientId }).first();
    expect(otherAfter).toMatchObject({ tax_id_number: 'OTHER-TENANT', properties: {} });
    const snapshot = await db('clients').where({ tenant }).whereIn('client_id', ids).orderBy('client_id').select('*');
    await migration.consolidateTenant(db, tenant);
    const secondRun = await db('clients').where({ tenant }).whereIn('client_id', ids).orderBy('client_id').select('*');
    expect(secondRun).toEqual(snapshot);
  });
});
