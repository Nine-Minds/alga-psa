import { beforeEach, describe, expect, it, vi } from 'vitest';

// Records the query a revoke builds so the where-clauses can be asserted.
const calls = vi.hoisted(() => ({ where: [] as any[], whereRaw: [] as any[], whereNull: [] as any[], update: [] as any[] }));
vi.mock('@alga-psa/db', () => {
  const chain: any = {
    where: (w: any) => { calls.where.push(w); return chain; },
    whereRaw: (sql: string, params: any[]) => { calls.whereRaw.push([sql, params]); return chain; },
    whereNull: (c: string) => { calls.whereNull.push(c); return chain; },
    update: async (u: any) => { calls.update.push(u); return 2; },
  };
  return { getConnection: vi.fn(), tenantDb: vi.fn(() => ({ table: () => chain })) };
});

import { mint, revoke } from './quoteAccessLinks';

const knex: any = { fn: { now: () => 'NOW()' } };

beforeEach(() => {
  calls.where.length = calls.whereRaw.length = calls.whereNull.length = calls.update.length = 0;
});

describe('revoke targets', () => {
  it('quoteId + recipientEmail matches case-insensitively and only live links', async () => {
    const n = await revoke(knex, 't1', { quoteId: 'q1', recipientEmail: '  Client@Example.COM ' }, 'superseded');
    expect(n).toBe(2);
    expect(calls.where).toEqual([{ quote_id: 'q1' }]);
    expect(calls.whereRaw).toEqual([['lower(recipient_email) = ?', ['client@example.com']]]);
    expect(calls.whereNull).toEqual(['revoked_at']);
    expect(calls.update[0]).toMatchObject({ revoked_reason: 'superseded' });
  });

  it('quoteId alone revokes every recipient (no email filter)', async () => {
    await revoke(knex, 't1', { quoteId: 'q1' }, 'cancelled');
    expect(calls.where).toEqual([{ quote_id: 'q1' }]);
    expect(calls.whereRaw).toEqual([]);
  });

  it('linkId targets a single link', async () => {
    await revoke(knex, 't1', { linkId: 'l1' }, 'manual');
    expect(calls.where).toEqual([{ link_id: 'l1' }]);
    expect(calls.whereRaw).toEqual([]);
  });
});

describe('mint lifetime', () => {
  it('passes lifetimeHours through to expires_at', async () => {
    const inserted: any[] = [];
    const db = await import('@alga-psa/db');
    (db.tenantDb as any).mockReturnValueOnce({
      table: () => ({ insert: (row: any) => { inserted.push(row); return { returning: async () => [row] }; } }),
    });
    const before = Date.now();
    await mint(knex, 't1', { quote: { quote_id: 'q1', valid_until: null } as any, recipient: { email: 'a@b.c' }, lifetimeHours: 48 });
    const delta = inserted[0].expires_at.getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(48 * 3600_000 - 1000);
    expect(delta).toBeLessThan(48 * 3600_000 + 5000);
  });
});
