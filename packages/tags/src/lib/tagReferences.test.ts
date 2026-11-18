import { describe, expect, it, vi } from 'vitest';

const calls: Array<[string, ...unknown[]]> = [];
const table = {
  where: vi.fn((...a: unknown[]) => { calls.push(['where', ...a]); return table; }),
  del: vi.fn(async () => { calls.push(['del']); return 1; }),
  insert: vi.fn(async (rows: unknown) => { calls.push(['insert', rows]); }),
};
vi.mock('@alga-psa/db', () => ({
  tenantDb: vi.fn((_trx: unknown, tenant: string) => ({
    table: (name: string) => { calls.push(['table', name, tenant]); return table; },
  })),
}));

import { deleteTagReferences, replaceTagReferences } from './tagReferences';

const trx = { isTransaction: true } as any;

describe('tag references API', () => {
  it('refuses to run without a transaction', async () => {
    await expect(replaceTagReferences({} as any, 't', 'x', 'r', [])).rejects.toThrow(/transaction/);
    await expect(deleteTagReferences({} as any, 't', 'x', 'r')).rejects.toThrow(/transaction/);
  });

  it('requires tenant, referrer type and referrer id', async () => {
    await expect(replaceTagReferences(trx, '', 'x', 'r', [])).rejects.toThrow(/tenant/);
    await expect(replaceTagReferences(trx, 't', ' ', 'r', [])).rejects.toThrow(/referrerType/);
    await expect(deleteTagReferences(trx, 't', 'x', '')).rejects.toThrow(/referrerId/);
  });

  it('replaces: deletes the referrer\'s rows then inserts the deduplicated set, tenant-scoped', async () => {
    calls.length = 0;
    await replaceTagReferences(trx, 'tenant-1', 'whatever', 'ref-1', ['a', 'b', 'a']);
    expect(calls.find((c) => c[0] === 'table')).toEqual(['table', 'tag_references', 'tenant-1']);
    expect(calls).toContainEqual(['where', { referrer_type: 'whatever', referrer_id: 'ref-1' }]);
    expect(calls.findIndex((c) => c[0] === 'del')).toBeLessThan(calls.findIndex((c) => c[0] === 'insert'));
    expect(calls.find((c) => c[0] === 'insert')![1]).toEqual([
      { tenant: 'tenant-1', tag_id: 'a', referrer_type: 'whatever', referrer_id: 'ref-1' },
      { tenant: 'tenant-1', tag_id: 'b', referrer_type: 'whatever', referrer_id: 'ref-1' },
    ]);
  });

  it('replacing with an empty set only deletes', async () => {
    calls.length = 0;
    await replaceTagReferences(trx, 't', 'x', 'r', []);
    expect(calls.some((c) => c[0] === 'insert')).toBe(false);
    expect(calls.some((c) => c[0] === 'del')).toBe(true);
  });

  it('delete removes only that referrer\'s rows', async () => {
    calls.length = 0;
    await deleteTagReferences(trx, 't', 'x', 'r');
    expect(calls).toContainEqual(['where', { referrer_type: 'x', referrer_id: 'r' }]);
    expect(calls.some((c) => c[0] === 'del')).toBe(true);
  });
});
