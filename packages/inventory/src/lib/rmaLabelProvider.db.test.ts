/**
 * C5 T024 (real DB): the RMA label view-model provider.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import knexLib, { type Knex } from 'knex';

const holder: { knex: Knex; tenant: string; grants: Set<string> | null } = { knex: undefined as never, tenant: '', grants: null };

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async (_u: unknown, resource: string, action: string) => holder.grants === null || holder.grants.has(`${resource}:${action}`),
}));
vi.mock('@alga-psa/db', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createTenantKnex: async () => ({ knex: holder.knex, tenant: holder.tenant }),
  withTransaction: (db: Knex, fn: (trx: Knex.Transaction) => Promise<unknown>) => db.transaction(fn),
}));
const denied = vi.hoisted(() => ({ assetIds: new Set<string>() }));
vi.mock('@alga-psa/assets/lib/assetReadAuthorization', async (orig) => {
  const actual = await orig<typeof import('@alga-psa/assets/lib/assetReadAuthorization')>();
  return {
    ...actual,
    isAssetReadAllowed: async (...args: Parameters<typeof actual.isAssetReadAllowed>) =>
      denied.assetIds.has(args[3].asset_id) ? false : actual.isAssetReadAllowed(...args),
    filterReadableAssets: async (...args: Parameters<typeof actual.filterReadableAssets>) =>
      (await actual.filterReadableAssets(...args)).filter((a) => !denied.assetIds.has(a.asset_id)),
  };
});

import { rmaLabelViewModelProvider } from './rmaLabelViewModelProvider';
import { createInventoryTestTenant, getInventoryTestDatabaseConnection } from '../test-utils/inventoryTestDatabase';

let knex: Knex;
let CLIENT: string;
let USER: any;
const BASE = 'https://psa.example.test';

const ctx = () => ({ tenant: holder.tenant, user: USER, baseUrl: BASE }) as any;

async function newAssetCase(over: { name: string; serial: string; tag: string; rma_number: string }) {
  const assetId = randomUUID();
  await knex('assets').insert({
    tenant: holder.tenant, asset_id: assetId, asset_type: 'unknown', client_id: CLIENT, asset_tag: over.tag,
    name: over.name, serial_number: over.serial, model: 'WD19', manufacturer: 'Dell', status: 'active', location: '',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  const vendor = await knex('vendors').where({ tenant: holder.tenant }).first();
  const rmaId = randomUUID();
  await knex('rma_cases').insert({
    tenant: holder.tenant, rma_id: rmaId, rma_number: over.rma_number, rma_type: 'standard', status: 'awaiting_return',
    asset_id: assetId, client_id: CLIENT, vendor_id: vendor.vendor_id, rma_reference: 'DELL-77', return_by: '2026-11-20',
    outbound_carrier: 'UPS', outbound_tracking_number: '1Z999',
  });
  return { assetId, rmaId };
}

beforeAll(async () => {
  knex = knexLib({ client: 'pg', connection: getInventoryTestDatabaseConnection(), pool: { min: 1, max: 4 } });
  holder.knex = knex;
  holder.tenant = await createInventoryTestTenant(knex);
  CLIENT = (await knex('clients').where({ tenant: holder.tenant }).first()).client_id;
  USER = { ...(await knex('users').where({ tenant: holder.tenant }).first()), tenant: holder.tenant };
});
beforeEach(() => { holder.grants = null; denied.assetIds.clear(); });
afterAll(async () => { await knex?.destroy(); });

describe('T024 rmaLabelViewModelProvider', () => {
  it('returns the view model; null for a missing case, a caller without warranty:read, and an unreadable asset; batch order preserved', async () => {
    const a = await newAssetCase({ name: 'Dell WD19 dock', serial: 'SN-ABCDEF123456', tag: 'TAG-A', rma_number: 'RMA-9001' });
    const b = await newAssetCase({ name: 'Dell monitor', serial: 'SN-ZZZ999', tag: 'TAG-B', rma_number: 'RMA-9002' });
    const c = await newAssetCase({ name: 'Dell laptop', serial: 'SN-QQQ777', tag: 'TAG-C', rma_number: 'RMA-9003' });
    const missing = randomUUID();

    expect(rmaLabelViewModelProvider).toMatchObject({ entityType: 'rma', labelClass: 'rma-work-tag' });

    const [vm] = await rmaLabelViewModelProvider.getLabelViewModels(ctx(), [a.rmaId]);
    expect(vm).toMatchObject({
      labelClass: 'rma-work-tag', entityType: 'rma', recordId: a.rmaId, identifier: 'RMA-9001', code128Value: 'RMA-9001',
      title: 'Dell WD19 dock', clientName: 'Inventory customer', secondaryIdentifier: 'TAG-A', serialSuffix: expect.any(String),
      rma: { statusLabel: 'Awaiting return', returnBy: expect.anything(), shipping: 'UPS 1Z999' },
    });
    expect(vm!.detail).toContain('DELL-77');
    expect(vm!.url).toContain(BASE);
    expect(vm!.url).toContain(a.rmaId);

    // missing case
    expect(await rmaLabelViewModelProvider.getLabelViewModels(ctx(), [missing])).toEqual([null]);

    // caller without warranty:read (and no inventory:read)
    holder.grants = new Set(['asset:update']);
    expect(await rmaLabelViewModelProvider.getLabelViewModels(ctx(), [a.rmaId, b.rmaId])).toEqual([null, null]);
    holder.grants = new Set(['warranty:read']);
    expect((await rmaLabelViewModelProvider.getLabelViewModels(ctx(), [a.rmaId]))[0]).not.toBeNull();
    holder.grants = null;

    // unreadable asset
    denied.assetIds.add(b.assetId);
    const hidden = await rmaLabelViewModelProvider.getLabelViewModels(ctx(), [b.rmaId]);
    expect(hidden).toEqual([null]);
    expect(hidden).toEqual(await rmaLabelViewModelProvider.getLabelViewModels(ctx(), [missing]));

    // batch order: input order, nulls in place, duplicates repeated
    const batch = await rmaLabelViewModelProvider.getLabelViewModels(ctx(), [c.rmaId, missing, b.rmaId, a.rmaId, c.rmaId]);
    expect(batch.map((x) => x?.identifier ?? null)).toEqual(['RMA-9003', null, null, 'RMA-9001', 'RMA-9003']);
    denied.assetIds.clear();
    const full = await rmaLabelViewModelProvider.getLabelViewModels(ctx(), [c.rmaId, b.rmaId, a.rmaId]);
    expect(full.map((x) => x?.identifier)).toEqual(['RMA-9003', 'RMA-9002', 'RMA-9001']);
    expect(await rmaLabelViewModelProvider.getLabelViewModels(ctx(), [])).toEqual([]);
  });
});
