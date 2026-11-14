import { describe, expect, it, vi } from 'vitest';

const records: { wheres: unknown[]; whereIns: unknown[]; whereNulls: string[]; orderBys: unknown[] }[] = [];
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: () => {
      const r = { wheres: [] as unknown[], whereIns: [] as unknown[], whereNulls: [] as string[], orderBys: [] as unknown[] };
      records.push(r);
      const b: any = {};
      b.where = (a: unknown) => { r.wheres.push(a); return b; };
      b.andWhere = (a: unknown) => { r.wheres.push(a); return b; };
      b.whereIn = (...a: unknown[]) => { r.whereIns.push(a); return b; };
      b.whereNull = (c: string) => { r.whereNulls.push(c); return b; };
      b.orderBy = (...a: unknown[]) => { r.orderBys.push(a); return b; };
      b.limit = () => b;
      b.then = (res: (v: unknown[]) => unknown) => Promise.resolve([]).then(res);
      return b;
    }
  })
}));

import { SyncOperationsRepository } from './syncOperationsRepository';

describe('SyncOperationsRepository.listErrored', () => {
  it('lists only skipped/failed for the adapter and realm, newest first', async () => {
    await new SyncOperationsRepository({} as any).listErrored('t', 'xero', 'conn-1');
    const r = records.at(-1)!;
    expect(r.wheres).toContainEqual({ adapter_type: 'xero' });
    expect(r.wheres).toContainEqual({ target_realm: 'conn-1' });
    expect(r.whereIns).toContainEqual(['status', ['skipped', 'failed']]);
    expect(r.orderBys).toContainEqual(['created_at', 'desc']);
  });

  it('matches null realm via IS NULL, like countByStatus', async () => {
    await new SyncOperationsRepository({} as any).listErrored('t', 'xero', null);
    expect(records.at(-1)!.whereNulls).toContain('target_realm');
  });
});
