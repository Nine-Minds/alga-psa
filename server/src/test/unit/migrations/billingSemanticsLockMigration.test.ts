import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migration = require('../../../../migrations/20260904130000_billing_semantics_lock.cjs');

function createDatabase(citus: boolean) {
  const tables = new Set(['contracts', 'service_catalog']);
  const distributed = new Set(citus ? ['contracts'] : []);
  const triggers = new Set<string>();
  let failOn = '';
  const knex = {
    schema: {
      hasTable: async (table: string) => tables.has(table),
      createTable: vi.fn(async (table: string) => {
        if (tables.has(table)) throw new Error('table already exists');
        tables.add(table);
      }),
      dropTableIfExists: async (table: string) => {
        tables.delete(table);
        distributed.delete(table);
        triggers.delete(table);
      },
    },
    raw: vi.fn(async (sql: string, bindings: string[] = []) => {
      if (failOn && sql.includes(failOn)) {
        failOn = '';
        throw new Error('injected failure');
      }
      if (sql.includes('FROM pg_proc')) return { rows: [{ exists: citus }] };
      if (sql.includes('FROM pg_dist_partition')) {
        if (!citus) throw new Error('pg_dist_partition does not exist');
        return { rows: [{ is_distributed: distributed.has(bindings[0]) }] };
      }
      if (sql.includes('SELECT create_distributed_table')) {
        if (distributed.has('billing_semantics_locks')) throw new Error('already distributed');
        distributed.add('billing_semantics_locks');
      } else if (sql.includes('FROM pg_trigger')) {
        return { rows: [{ exists: triggers.has(bindings[0]) }] };
      } else if (sql.startsWith('CREATE TRIGGER') || sql.startsWith('DROP TRIGGER')) {
        const table = bindings[0];
        if (distributed.has(table)) throw new Error('triggers unsupported on distributed tables');
        if (sql.startsWith('CREATE')) {
          if (triggers.has(table)) throw new Error('trigger already exists');
          triggers.add(table);
        } else {
          triggers.delete(table);
        }
      }
      return { rows: [] };
    }),
  };
  return { knex, tables, distributed, triggers, failNext: (sql: string) => { failOn = sql; } };
}

describe('billing semantics lock migration', () => {
  it('keeps distribution and function DDL out of a shared Knex transaction', () => {
    expect(migration.config).toEqual({ transaction: false });
  });

  it.each([false, true])('supports rerunning up and down (Citus: %s)', async (citus) => {
    const db = createDatabase(citus);
    await migration.up(db.knex);
    await migration.up(db.knex);

    expect(db.knex.schema.createTable).toHaveBeenCalledTimes(1);
    expect([...db.triggers].sort()).toEqual(citus
      ? ['service_catalog']
      : ['billing_semantics_locks', 'contracts', 'service_catalog']);
    expect(db.distributed.has('billing_semantics_locks')).toBe(citus);

    await migration.down(db.knex);
    await migration.down(db.knex);
    expect(db.triggers.size).toBe(0);
    expect(db.tables.has('billing_semantics_locks')).toBe(false);
    expect(db.tables.has('contracts')).toBe(true);
  });

  it.each([
    [true, 'SELECT create_distributed_table'],
    [true, 'CREATE OR REPLACE FUNCTION'],
    [false, 'CREATE TRIGGER'],
  ] as const)('recovers after a committed step before %s / %s fails', async (citus, sql) => {
    const db = createDatabase(citus);
    db.failNext(sql);
    await expect(migration.up(db.knex)).rejects.toThrow('injected failure');
    expect(db.tables.has('billing_semantics_locks')).toBe(true);

    await migration.up(db.knex);
    expect(db.knex.schema.createTable).toHaveBeenCalledTimes(1);
    expect(db.triggers.has('service_catalog')).toBe(true);
    expect(db.distributed.has('billing_semantics_locks')).toBe(citus);
  });
});
