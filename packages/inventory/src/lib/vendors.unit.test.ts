import { describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createOrMatchVendorCore, createVendorCore, normalizeVendorName } from './vendors';

/** In-memory `vendors` table behind just enough of the knex surface the core uses. */
function vendorsTransaction(rows: Array<Record<string, any>>): Knex.Transaction {
  const trx = ((table: string) => {
    if (table !== 'vendors') throw new Error(`unexpected table ${table}`);
    let needle: string | null = null;
    const query: any = {
      where: () => query,
      whereRaw: (_sql: string, bindings: string[]) => {
        needle = bindings[0].toLowerCase();
        return query;
      },
      first: async () => rows.find((row) => needle !== null && row.vendor_name.trim().toLowerCase() === needle),
      insert: (row: Record<string, any>) => ({
        returning: async () => {
          const stored = { vendor_id: `v${rows.length + 1}`, ...row };
          rows.push(stored);
          return [stored];
        },
      }),
    };
    return query;
  }) as unknown as Knex.Transaction;
  return trx;
}

describe('vendor cores', () => {
  it('normalizes names', () => {
    expect(normalizeVendorName('  Ingram Micro ')).toBe('Ingram Micro');
    expect(normalizeVendorName(null)).toBe('');
  });

  it('rejects blank names and duplicates differing only by case or padding', async () => {
    const rows = [{ vendor_id: 'v0', vendor_name: 'Ingram Micro' }];
    const trx = vendorsTransaction(rows);
    expect(await createVendorCore(trx, 't', { vendor_name: '   ' })).toEqual({ ok: false, code: 'name_required' });
    expect(await createVendorCore(trx, 't', { vendor_name: ' ingram MICRO ' })).toEqual({
      ok: false,
      code: 'duplicate_name',
      name: 'ingram MICRO',
    });
    expect(rows).toHaveLength(1);
  });

  it('creates once, then matches the same vendor regardless of case and padding', async () => {
    const rows: Array<Record<string, any>> = [];
    const trx = vendorsTransaction(rows);
    const first = await createOrMatchVendorCore(trx, 't', ' TD Synnex ');
    expect(first.created).toBe(true);
    expect(first.vendor.vendor_name).toBe('TD Synnex');
    const second = await createOrMatchVendorCore(trx, 't', 'td synnex');
    expect(second.created).toBe(false);
    expect(second.vendor.vendor_id).toBe(first.vendor.vendor_id);
    expect(rows).toHaveLength(1);
  });
});
