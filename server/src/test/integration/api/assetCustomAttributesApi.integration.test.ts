import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { AssetService } from '@/lib/api/services/AssetService';

vi.mock('server/src/lib/eventBus/publishers', () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }));
let db: Knex;
const tenantIds = new Set<string>();
const table = (tenant: string, name: string) => tenantDb(db, tenant).table(name);
const tenantRows = () => tenantDb(db, '__fixture__').unscoped('tenants', 'integration fixture setup and cleanup');
const service = (tenant: string) => {
  const instance = new AssetService();
  vi.spyOn(instance, 'getKnex').mockResolvedValue({ knex: db, tenant } as any);
  return instance;
};
async function fixture() {
  const tenant = uuidv4(); tenantIds.add(tenant);
  const tenantInfo = await tenantRows().columnInfo();
  await tenantRows().insert({ tenant, email: `asset-${tenant}@example.com`, ...(tenantInfo.company_name ? { company_name: `Tenant ${tenant}` } : { client_name: `Tenant ${tenant}` }) });
  const clientId = uuidv4();
  await table(tenant, 'clients').insert({ tenant, client_id: clientId, client_name: `Client ${tenant}` });
  await table(tenant, 'asset_type_registry').insert({ tenant, slug: 'rmm_endpoint', name: 'RMM Endpoint', is_builtin: false, display_order: 0, fields_schema: JSON.stringify([
    { key: 'tactical_agent_id', label: 'Tactical Agent ID', kind: 'url', required: true },
    { key: 'screenconnect_guid', label: 'ScreenConnect GUID', kind: 'url', required: false },
    { key: 'seats', label: 'Seats', kind: 'number', required: false },
    { key: 'env', label: 'Environment', kind: 'select', options: ['prod', 'qa'], required: false },
  ]) });
  await table(tenant, 'asset_type_registry').insert({ tenant, slug: 'second_custom', name: 'Second Custom', is_builtin: false, display_order: 1, fields_schema: JSON.stringify([{ key: 'code', label: 'Code', kind: 'number', required: true }]) });
  return { tenant, clientId, svc: service(tenant), context: { tenant, userId: uuidv4(), db } as any };
}
async function createAsset(f: Awaited<ReturnType<typeof fixture>>, attrs: Record<string, unknown>, type = 'rmm_endpoint') {
  return f.svc.create({ client_id: f.clientId, asset_type: type, asset_tag: `tag-${uuidv4()}`, name: 'Endpoint', status: 'active', attributes: attrs } as any, f.context);
}
describe('REST asset custom attributes', () => {
  beforeAll(async () => { process.env.APP_ENV ||= 'test'; db = await createTestDbConnection({ runSeeds: false }); }, 180_000);
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const tenant of tenantIds) {
      await table(tenant, 'assets').del(); await table(tenant, 'asset_type_registry').del(); await table(tenant, 'clients').del();
      await tenantRows().where({ tenant }).del();
    }
    tenantIds.clear();
  });
  afterAll(async () => { await db?.destroy().catch(() => undefined); }, 180_000);

  it('creates custom attributes and returns them through reads as JSON objects', async () => {
    const f = await fixture();
    const attrs = { tactical_agent_id: 'https://rmm.example/agent/1', screenconnect_guid: 'https://sc.example/host/1' };
    const created = await createAsset(f, attrs);
    expect(created.attributes).toEqual(attrs);
    expect((await f.svc.getById(created.asset_id, f.context)).attributes).toEqual(attrs);
    expect((await f.svc.getWithDetails(created.asset_id, f.context)).attributes).toEqual(attrs);
    const listed = await f.svc.list({ page: 1, limit: 100 } as any, f.context, { asset_type: 'rmm_endpoint' } as any);
    expect(listed.data.map((asset: any) => asset.attributes)).toContainEqual(attrs);
    expect((await table(f.tenant, 'assets').where({ asset_id: created.asset_id }).first()).attributes).toEqual(attrs);
  });
  it('rejects create when a required attribute is missing before inserting a row', async () => {
    const f = await fixture(); const before = Number((await table(f.tenant, 'assets').count('* as count').first())?.count);
    await expect(createAsset(f, {})).rejects.toMatchObject({ details: [{ path: ['attributes', 'tactical_agent_id'], code: 'required' }] });
    expect(Number((await table(f.tenant, 'assets').count('* as count').first())?.count)).toBe(before);
  });
  it('rejects invalid number and select values on create', async () => {
    const f = await fixture();
    await expect(createAsset(f, { tactical_agent_id: 'ok', seats: 'ten' })).rejects.toMatchObject({ details: [{ path: ['attributes', 'seats'], code: 'invalid_value' }] });
    await expect(createAsset(f, { tactical_agent_id: 'ok', env: 'dev' })).rejects.toMatchObject({ details: [{ path: ['attributes', 'env'], code: 'invalid_value' }] });
  });
  it('maps unknown create types to a 400 and inserts no row', async () => {
    const f = await fixture(); const before = Number((await table(f.tenant, 'assets').count('* as count').first())?.count);
    await expect(createAsset(f, { tactical_agent_id: 'ok' }, 'not_registered')).rejects.toMatchObject({ statusCode: 400, details: [{ path: ['asset_type'], code: 'invalid_asset_type' }] });
    expect(Number((await table(f.tenant, 'assets').count('* as count').first())?.count)).toBe(before);
  });
  it('merges updates and preserves integration namespace keys', async () => {
    const f = await fixture(); const initial = { tactical_agent_id: 'agent', screenconnect_guid: 'old' }; const created = await createAsset(f, initial);
    await table(f.tenant, 'assets').where({ asset_id: created.asset_id }).update({ attributes: JSON.stringify({ ...initial, hudu_fields: { id: 'h1' } }) });
    const updated = await f.svc.update(created.asset_id, { attributes: { screenconnect_guid: 'new' } } as any, f.context);
    expect(updated.attributes).toEqual({ ...initial, screenconnect_guid: 'new', hudu_fields: { id: 'h1' } });
  });
  it('rejects blanking a required attribute and preserves the stored value', async () => {
    const f = await fixture(); const created = await createAsset(f, { tactical_agent_id: 'agent' });
    await expect(f.svc.update(created.asset_id, { attributes: { tactical_agent_id: '' } } as any, f.context)).rejects.toMatchObject({ details: [{ path: ['attributes', 'tactical_agent_id'], code: 'required' }] });
    expect((await table(f.tenant, 'assets').where({ asset_id: created.asset_id }).first('attributes')).attributes.tactical_agent_id).toBe('agent');
  });
  it('leaves attributes untouched when an update omits them', async () => {
    const f = await fixture(); const attrs = { tactical_agent_id: 'agent', hudu_fields: { id: 'h1' } }; const created = await createAsset(f, attrs);
    await f.svc.update(created.asset_id, { name: 'Updated' } as any, f.context);
    expect((await table(f.tenant, 'assets').where({ asset_id: created.asset_id }).first('attributes')).attributes).toEqual(attrs);
  });
  it('validates a type change against the new type schema', async () => {
    const f = await fixture(); const created = await createAsset(f, { tactical_agent_id: 'agent' });
    await expect(f.svc.update(created.asset_id, { asset_type: 'second_custom', attributes: { code: 42 } } as any, f.context)).resolves.toBeTruthy();
    await expect(f.svc.update(created.asset_id, { asset_type: 'rmm_endpoint', attributes: { seats: 'many' } } as any, f.context)).rejects.toMatchObject({ details: [{ path: ['attributes', 'seats'], code: 'invalid_value' }] });
  });
  it('accepts arbitrary attributes on built-in types', async () => {
    const attrs = { totally_arbitrary: { retained: true } }; const created = await createAsset(await fixture(), attrs, 'workstation');
    expect(created.attributes).toEqual(attrs);
  });
  it('bulk updates two custom types using each type registry schema', async () => {
    const f = await fixture(); const rmm = await createAsset(f, { tactical_agent_id: 'agent' }); const second = await createAsset(f, { code: 2 }, 'second_custom');
    const { bulkUpdateAssetSchema } = await import('@/lib/api/schemas/asset');
    const bulk = bulkUpdateAssetSchema.parse({ assets: [{ asset_id: rmm.asset_id, data: { attributes: { seats: 3 } } }, { asset_id: second.asset_id, data: { attributes: { code: 4 } } }] });
    for (const item of bulk.assets) await f.svc.update(item.asset_id, item.data as any, f.context);
    expect((await table(f.tenant, 'assets').where({ asset_id: rmm.asset_id }).first('attributes')).attributes.seats).toBe(3);
    expect((await table(f.tenant, 'assets').where({ asset_id: second.asset_id }).first('attributes')).attributes.code).toBe(4);
    await expect(f.svc.update(second.asset_id, { attributes: { code: 'four' } } as any, f.context)).rejects.toMatchObject({ details: [{ path: ['attributes', 'code'], code: 'invalid_value' }] });
  });
});
