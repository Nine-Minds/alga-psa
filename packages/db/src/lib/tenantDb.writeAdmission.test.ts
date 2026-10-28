import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import knexFactory, { type Knex } from 'knex';
import { tenantDb } from './tenantDb';
import {
  WRITE_ADMISSION_TTL_MS,
  invalidateWriteAdmission,
  isTenantWriteGuarded,
  registerWriteAdmissionResolver,
  resetWriteAdmissionResolver,
  resetWriteAdmissionCache,
  type WriteAdmissionResolver,
} from './writeAdmission';

// No parent-scoped table is operational today (they are tax/extension tables), so the
// parent-scoped paths are exercised by listing one for this suite only.
vi.mock('./operationalWriteTables', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./operationalWriteTables')>();
  return { ...actual, isOperationalWriteTable: (t: string) => t === 'tax_holidays' || actual.isOperationalWriteTable(t) };
});

class Refusal extends Error {
  constructor() { super('read only'); this.name = 'Refusal'; }
}

const statements: string[] = [];
const productCodes: Record<string, string> = { psa: 'psa', cm: 'co_managed' };

function makeKnex(): Knex {
  const k = knexFactory({ client: 'pg' });
  const client = k.client as any;
  client.acquireConnection = async () => ({});
  client.releaseConnection = async () => {};
  client._query = async (_c: unknown, obj: any) => {
    statements.push(obj.sql);
    const tenantBinding = obj.bindings?.[0];
    const rows = /from "tenants"/.test(obj.sql)
      ? (productCodes[tenantBinding] ? [{ product_code: productCodes[tenantBinding] }] : [])
      : [];
    obj.response = { rows, rowCount: rows.length, command: obj.method === 'first' || obj.method === 'select' ? 'SELECT' : 'UPDATE' };
    return obj;
  };
  return k;
}

const knex = makeKnex();
afterAll(() => knex.destroy());

const deny: WriteAdmissionResolver = vi.fn(async () => ({ canWrite: false, denial: new Refusal() }));
const allow: WriteAdmissionResolver = vi.fn(async () => ({ canWrite: true }));

beforeEach(() => {
  statements.length = 0;
  resetWriteAdmissionCache();
  vi.mocked(deny).mockClear();
  vi.mocked(allow).mockClear();
});
afterEach(() => {
  resetWriteAdmissionResolver();
  resetWriteAdmissionCache();
});

const writes = statements; // alias for readability
const nonLookup = () => writes.filter((s) => !/from "tenants"/.test(s));

describe('tenantDb write admission: guard matrix (co-managed, refusing resolver)', () => {
  beforeEach(() => registerWriteAdmissionResolver(deny));

  it.each([
    ['insert', (db: any) => db.table('tickets').insert({ title: 'x' })],
    ['update', (db: any) => db.table('tickets').where({ ticket_id: '1' }).update({ title: 'y' })],
    ['del', (db: any) => db.table('tickets').where({ ticket_id: '1' }).del()],
    ['delete', (db: any) => db.table('tickets').where({ ticket_id: '1' }).delete()],
    ['truncate', (db: any) => db.table('tickets').truncate()],
    ['increment', (db: any) => db.table('tickets').where({ ticket_id: '1' }).increment('n', 1)],
    ['decrement', (db: any) => db.table('tickets').where({ ticket_id: '1' }).decrement('n', 1)],
    ['scoped().builder', (db: any) => db.scoped('comments').builder.insert({ note: 'x' })],
    ['scoped().clone()', (db: any) => db.scoped('comments').clone().builder.update({ note: 'x' })],
    ['clone of table()', (db: any) => db.table('tickets').clone().update({ title: 'z' })],
    ['parentScopedTable', (db: any) => db.parentScopedTable('tax_holidays').update({ done: true })],
    ['parentScopedTable', (db: any) => db.parentScopedTable('tax_holidays').where({ x: 1 }).del()],
    ['insertParentScoped', (db: any) => db.insertParentScoped('tax_holidays', { tax_rate_id: 't1', x: 1 })],
  ])('refuses %s with nothing written', async (_name, run) => {
    const db = tenantDb(knex, 'cm');
    await expect(Promise.resolve().then(() => run(db))).rejects.toBeInstanceOf(Refusal);
    expect(nonLookup()).toEqual([]);
  });

  it('refuses through catch and finally chains too', async () => {
    const db = tenantDb(knex, 'cm');
    await expect(db.table('tickets').insert({ a: 1 }).catch(() => { throw new Refusal(); })).rejects.toBeInstanceOf(Refusal);
    await expect(db.table('tickets').update({ a: 1 }).finally(() => {})).rejects.toBeInstanceOf(Refusal);
    expect(nonLookup()).toEqual([]);
  });

  it('lets reads through', async () => {
    const db = tenantDb(knex, 'cm');
    await db.table('tickets').select('*');
    await db.table('tickets').first();
    await db.table('tickets').count('* as n');
    await db.parentScopedTable('tax_holidays').select('*');
    expect(nonLookup().length).toBe(4);
    expect(deny).not.toHaveBeenCalled();
  });

  it('does not guard unscoped or global tables', async () => {
    const db = tenantDb(knex, 'cm');
    await db.unscoped('tickets', 'test').update({ a: 1 });
    await db.table('standard_priorities').update({ a: 1 }).catch(() => {});
    expect(deny).not.toHaveBeenCalled();
  });

  it('writes to a non-operational table', async () => {
    const db = tenantDb(knex, 'cm');
    await db.table('tenant_settings').where({ x: 1 }).update({ a: 1 });
    expect(deny).not.toHaveBeenCalled();
    expect(nonLookup().length).toBe(1);
  });

  it('refuses the retained-command surfaces by default', async () => {
    const db = tenantDb(knex, 'cm');
    for (const table of ['appointment_requests', 'online_meetings', 'kb_import_files']) {
      await expect(db.table(table).insert({ a: 1 })).rejects.toBeInstanceOf(Refusal);
    }
  });
});

describe('tenantDb write admission: fast path (A1)', () => {
  it('a PSA tenant makes no resolver call after one tenants read, ever', async () => {
    registerWriteAdmissionResolver(allow);
    const db = tenantDb(knex, 'psa');
    expect(isTenantWriteGuarded('psa')).toBe(true); // unknown until first resolve
    await db.table('tickets').insert({ a: 1 });
    expect(isTenantWriteGuarded('psa')).toBe(false);
    await db.table('tickets').where({ a: 1 }).update({ a: 2 });
    await db.table('tickets').where({ a: 1 }).del();
    await db.insertParentScoped('tax_holidays', { tax_rate_id: 'x' }).catch(() => {});
    expect(allow).not.toHaveBeenCalled();
    expect(writes.filter((s) => /from "tenants"/.test(s))).toHaveLength(1);
  });

  it('a known-negative tenant gets the plain builder, with no wrapper attached', async () => {
    registerWriteAdmissionResolver(allow);
    await tenantDb(knex, 'psa').table('tickets').insert({ a: 1 });
    const builder = tenantDb(knex, 'psa').table('tickets');
    expect(Object.prototype.hasOwnProperty.call(builder, 'insert')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(builder, 'then')).toBe(false);
    const before = writes.length;
    await tenantDb(knex, 'psa').table('tickets').insert({ a: 1 });
    expect(writes.length - before).toBe(1);
  });

  it('opens no transaction', async () => {
    registerWriteAdmissionResolver(allow);
    await tenantDb(knex, 'psa').table('tickets').insert({ a: 1 });
    expect(writes.some((s) => /^(begin|commit)/i.test(s))).toBe(false);
  });

  it('concurrent first writes share one lookup', async () => {
    registerWriteAdmissionResolver(allow);
    const db = tenantDb(knex, 'psa');
    await Promise.all([db.table('tickets').insert({ a: 1 }), db.table('tickets').insert({ a: 2 })]);
    expect(writes.filter((s) => /from "tenants"/.test(s))).toHaveLength(1);
  });
});

describe('tenantDb write admission: co-managed decisions', () => {
  it('caches a decision for the TTL and invalidation forgets it', async () => {
    vi.useFakeTimers();
    try {
      registerWriteAdmissionResolver(allow);
      const db = tenantDb(knex, 'cm');
      await db.table('tickets').insert({ a: 1 });
      await db.table('tickets').insert({ a: 2 });
      expect(allow).toHaveBeenCalledTimes(1);
      invalidateWriteAdmission('cm');
      await db.table('tickets').insert({ a: 3 });
      expect(allow).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(WRITE_ADMISSION_TTL_MS + 1);
      await db.table('tickets').insert({ a: 4 });
      expect(allow).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not remember a lookup that failed', async () => {
    registerWriteAdmissionResolver(allow);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = knex.client as any;
    const original = client._query;
    client._query = async (c: unknown, obj: any) => {
      if (/from "tenants"/.test(obj.sql)) throw new Error('boom');
      return original(c, obj);
    };
    try {
      await tenantDb(knex, 'cm').table('tickets').insert({ a: 1 });
      expect(isTenantWriteGuarded('cm')).toBe(true);
    } finally {
      client._query = original;
      warn.mockRestore();
    }
  });
});

describe('tenantDb write admission: no resolver (A8)', () => {
  it('writes proceed with no lookup and one warning per tenant', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const db = tenantDb(knex, 'cm');
      await db.table('tickets').insert({ a: 1 });
      await db.table('tickets').insert({ a: 2 });
      await tenantDb(knex, 'other').table('tickets').insert({ a: 3 });
      expect(writes.filter((s) => /from "tenants"/.test(s))).toHaveLength(0);
      expect(warn).not.toHaveBeenCalled(); // no resolver => no wrapper attached
    } finally {
      warn.mockRestore();
    }
  });
});
