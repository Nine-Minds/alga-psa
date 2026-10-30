import { describe, expect, it, vi } from 'vitest';

// Must run before any Date is constructed so the host-local getters below are New York time.
process.env.TZ = 'America/New_York';

const rows: Record<string, any> = {};
function chain(name: string) {
  const c: any = {
    where: () => c,
    forUpdate: () => c,
    leftJoin: () => c,
    orderBy: () => c,
    limit: () => c,
    select: () => c,
    first: async () => rows[name],
    update: async () => 1,
    insert: async () => [],
    then: (res: any, rej: any) => Promise.resolve(rows[`${name}:list`] ?? []).then(res, rej),
  };
  return c;
}
vi.mock('@alga-psa/db', () => ({ tenantDb: () => ({ table: (n: string) => chain(n.split(' ')[0]) }) }));
vi.mock('../assetReadAuthorization', () => ({
  createAssetReadContext: async () => ({}),
  filterReadableAssets: async (_k: any, _t: any, _c: any, a: any) => a,
  isAssetReadAllowed: async () => true,
}));

import { getAssetWarrantySummary } from './warrantyReads';
import { applyWarrantyReplacement } from './applyWarrantyReplacement';

const instant = () => new Date('2027-03-31T00:00:00Z');

describe('warranty_end_date is read as a UTC calendar date', () => {
  it('TZ pin took effect (local day is 30)', () => {
    expect(instant().getDate()).toBe(30);
  });

  it('warrantyReads path maps to 2027-03-31', async () => {
    rows.assets = { asset_id: 'a', ownership: 'client', warranty_end_date: instant(), vendor_id: null };
    const knex: any = { raw: (s: string) => s };
    const out = await getAssetWarrantySummary(knex, 't', {} as any, 'a');
    expect(out?.warranty_end_date).toBe('2027-03-31');
  });

  it('dateOnly path (applyWarrantyReplacement before) maps to 2027-03-31', async () => {
    rows.assets = { asset_id: 'a', serial_number: 'S', model: 'm', manufacturer: 'x', warranty_end_date: instant() };
    const trx: any = { fn: { now: () => 'now' } };
    const out = await applyWarrantyReplacement(trx, 't', {
      assetId: 'a', serialNumber: 'S2', rmaId: 'r', rmaNumber: 'RMA-1', actorUserId: 'u',
    });
    expect(out.before.warranty_end_date).toBe('2027-03-31');
    expect(out.after.warranty_end_date).toBe('2027-03-31');
  });
});
