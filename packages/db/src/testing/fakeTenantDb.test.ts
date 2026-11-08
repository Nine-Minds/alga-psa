import { describe, expect, it } from 'vitest';
import { fakeQueryBuilder } from './fakeQueryBuilder';
import { fakeTenantDb, fakeTenantScopedTable, fakeTransaction, fakeWithTransaction } from './fakeTenantDb';

describe('fakeQueryBuilder', () => {
  const rows = [
    { id: 1, tenant: 't1', kind: 'a', deleted_at: null },
    { id: 2, tenant: 't1', kind: 'b', deleted_at: '2026-01-01' },
    { id: 3, tenant: 't2', kind: 'a', deleted_at: null },
  ];

  it('narrows rows by filters and records them in order', async () => {
    const builder = fakeQueryBuilder({ rows });
    const result = await builder.where({ tenant: 't1' }).whereNull('deleted_at');
    expect(result.map((r: any) => r.id)).toEqual([1]);
    expect(builder.filters).toEqual([
      { method: 'where', args: [{ tenant: 't1' }] },
      { method: 'whereNull', args: ['deleted_at'] },
    ]);
  });

  it('absorbs unknown fluent methods but keeps terminals real', async () => {
    const builder = fakeQueryBuilder({ rows });
    const first = await builder.select('*').orderBy('id').limit(5).where('tenant', 't2').first();
    expect(first.id).toBe(3);
  });

  it('records lock calls and where() inside modify()', async () => {
    const locks: string[] = [];
    const builder = fakeQueryBuilder({ rows, onLock: (kind) => locks.push(kind) });
    await builder.modify((b: any) => b.where({ tenant: 't1' })).forUpdate();
    expect(locks).toEqual(['forUpdate']);
    expect(builder.filters.map((f) => f.method)).toEqual(['modify', 'where', 'forUpdate']);
  });

  it('fails loudly on an unmodelled whereRaw', () => {
    expect(() => fakeQueryBuilder({ rows }).whereRaw('x = 1')).toThrow(/unmodelled whereRaw/);
  });
});

describe('fakeTenantDb', () => {
  it('records the tenant and the exact handle each table access used', async () => {
    const trx = fakeTransaction();
    const db = fakeTenantDb({ tables: { tickets: [{ ticket_id: 'a', tenant: 't1' }] } });

    const rows = await db(trx, 't1').table('tickets').where({ tenant: 't1' });

    expect(rows).toHaveLength(1);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].table).toBe('tickets');
    expect(db.calls[0].tenant).toBe('t1');
    expect(db.calls[0].handle).toBe(trx);
    expect(db.calls[0].builder.filters).toEqual([{ method: 'where', args: [{ tenant: 't1' }] }]);
  });

  it('distinguishes a query that escaped its transaction', () => {
    const trx = fakeTransaction();
    const pool = { isTransaction: false };
    const db = fakeTenantDb();

    db(trx, 't1').table('a');
    db(pool, 't1').table('b');

    const escaped = db.calls.filter((call) => call.handle !== trx).map((call) => call.table);
    expect(escaped).toEqual(['b']);
  });

  it('prefers tenant-scoped rows and defaults unmodelled tables to empty', async () => {
    const db = fakeTenantDb({ tables: { 't1:docs': [{ id: 'mine' }], docs: [{ id: 'shared' }] } });
    expect(await db({}, 't1').table('docs')).toEqual([{ id: 'mine' }]);
    expect(await db({}, 't2').table('docs')).toEqual([{ id: 'shared' }]);
    expect(await db({}, 't1').table('unmodelled')).toEqual([]);
  });

  it('strict mode throws on an undeclared table', () => {
    expect(() => fakeTenantDb({ strict: true })({}, 't1').table('nope')).toThrow(/no rows declared for table "nope"/);
  });

  it('applies per-table options and insert hooks', async () => {
    const inserted: unknown[] = [];
    const db = fakeTenantDb({ perTable: { audit: { onInsert: (rows) => { inserted.push(...rows); } } } });
    await db({}, 't1').table('audit').insert({ id: 1 });
    expect(inserted).toEqual([{ id: 1 }]);
  });
});

describe('fakeTenantScopedTable', () => {
  it('keys on the bare table name and records tenant and handle', () => {
    const trx = fakeTransaction();
    const scoped = fakeTenantScopedTable({ tables: { tickets: [{ id: 1 }] } });
    expect(scoped(trx, 'tickets as t', 't9').selected).toEqual([{ id: 1 }]);
    expect(scoped.calls[0]).toMatchObject({ table: 'tickets', tenant: 't9', handle: trx });
  });
});

describe('fakeWithTransaction', () => {
  it('hands the callback a transaction and records the handle it opened on', async () => {
    const pool = {};
    const withTransaction = fakeWithTransaction();
    const seen = await withTransaction(pool, async (trx) => trx);
    expect((seen as any).isTransaction).toBe(true);
    expect(withTransaction.opened).toEqual([pool]);
    expect(withTransaction.transactions[0]).toBe(seen);
  });
});
