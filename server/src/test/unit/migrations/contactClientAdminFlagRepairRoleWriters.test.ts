import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * alga-2026-0003347: the second convergence of contacts.is_client_admin, for
 * the drift written since 20261118120000 by the user_roles writers that never
 * re-derived the flag (the v1 REST API, Entra sync, registration, invitation
 * and the user-creation paths).
 *
 * The flag decides portal scope — the visibility resolver widens a flagged
 * contact's ticket, asset and project reads to the whole client — so what is
 * pinned here is that the repair converges in both directions, pins the tenant
 * on both sides of every join (Citus, no RLS), and ends: the batch loop is
 * driven against a fake connection so a predicate that never shrinks, or a
 * batch loop that cannot terminate, fails as a hang-free assertion.
 */
const migrationPath = path.resolve(
  __dirname,
  '../../../../migrations/20261120090000_repair_contact_client_admin_flag_role_writers.cjs'
);
const source = readFileSync(migrationPath, 'utf8');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const migration = require(migrationPath);

const shippedRepair = readFileSync(
  path.resolve(__dirname, '../../../../migrations/20261118120000_repair_contact_client_admin_flag.cjs'),
  'utf8'
);

type RawCall = { sql: string; bindings: unknown[] };

/**
 * A fake connection: `rowCounts` is the queue of rows each batch reports, so a
 * loop that does not stop on a short batch runs out and throws instead of
 * hanging.
 */
function fakeKnex({ tenants, rowCounts }: { tenants: string[]; rowCounts: number[] }) {
  const calls: RawCall[] = [];
  const remaining = [...rowCounts];

  const trx = {
    raw: async (sql: string, bindings: unknown[] = []) => {
      calls.push({ sql, bindings });
      if (/SET LOCAL lock_timeout/.test(sql)) return { rowCount: 0 };
      const next = remaining.shift();
      if (next === undefined) {
        throw new Error('batch loop did not stop on a short batch');
      }
      return { rowCount: next };
    },
  };

  const knex: any = (table: string) => {
    expect(table).toBe('users');
    return {
      where: (criteria: Record<string, unknown>) => {
        expect(criteria).toEqual({ user_type: 'client' });
        return {
          distinct: (column: string) => {
            expect(column).toBe('tenant');
            return { pluck: async (picked: string) => (expect(picked).toBe('tenant'), tenants) };
          },
        };
      },
    };
  };
  knex.schema = { hasTable: async () => true };
  knex.transaction = async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx);

  return { knex, calls, remaining };
}

const updates = (calls: RawCall[]) => calls.filter((call) => !/SET LOCAL lock_timeout/.test(call.sql));

describe('contact client admin flag repair (role writers)', () => {
  it('leaves the first repair untouched and runs as its own migration', () => {
    expect(shippedRepair).toContain('alga-2026-0003317');
    expect(source).toContain('alga-2026-0003347');
    expect(source).toContain('exports.config = { transaction: false }');
    // A data repair has nothing to restore.
    expect(source).toMatch(/exports\.down = async function down\(\)/);
  });

  it('converges in both directions, for contacts that have a portal user only', () => {
    for (const sql of [migration.CLEAR_STALE_FLAG_SQL, migration.SET_MISSING_FLAG_SQL]) {
      expect(sql).toContain("u.user_type = 'client'");
      expect(sql).toContain('u.contact_id = c.contact_name_id');
      expect(sql).toContain('r.client = true');
      expect(sql).toContain("lower(r.role_name) = 'admin'");
    }
    expect(migration.CLEAR_STALE_FLAG_SQL).toContain('AND c.is_client_admin');
    expect(migration.CLEAR_STALE_FLAG_SQL).toContain('NOT EXISTS');
    expect(migration.CLEAR_STALE_FLAG_SQL).toContain('SET is_client_admin = false');
    expect(migration.SET_MISSING_FLAG_SQL).toContain('AND NOT c.is_client_admin');
    expect(migration.SET_MISSING_FLAG_SQL).toContain('AND EXISTS');
    expect(migration.SET_MISSING_FLAG_SQL).toContain('SET is_client_admin = true');
  });

  it('pins the tenant on both sides of every join (Citus, no RLS)', () => {
    for (const sql of [migration.CLEAR_STALE_FLAG_SQL, migration.SET_MISSING_FLAG_SQL]) {
      expect(sql).toContain('u.tenant = c.tenant');
      expect(sql).toContain('WHERE c.tenant = ?');
      expect(sql).toContain('AND u.tenant = ?');
      expect(sql).toContain('ur.tenant = c.tenant');
      expect(sql).toContain('r.tenant = ur.tenant');
      expect(sql).toContain('WHERE tgt.tenant = ?');
      // Four placeholders: the three tenant pins plus the batch limit.
      expect(sql.match(/\?/g)).toHaveLength(4);
    }
  });

  it('batches in short transactions with a lock timeout, one tenant at a time', async () => {
    // Two full batches then a short one closes the first pass; the second pass
    // of the same tenant ends on its first short batch.
    const { knex, calls } = fakeKnex({
      tenants: ['tenant-1'],
      rowCounts: [migration.BATCH_SIZE, migration.BATCH_SIZE, 12, 3],
    });

    await migration.up(knex);

    expect(updates(calls)).toHaveLength(4);
    expect(calls.filter((call) => /SET LOCAL lock_timeout = '2s'/.test(call.sql))).toHaveLength(4);
    for (const call of updates(calls)) {
      expect(call.bindings).toEqual(['tenant-1', 'tenant-1', migration.BATCH_SIZE, 'tenant-1']);
    }
    // Pass 1 clears the stale flags, pass 2 sets the missing ones.
    expect(updates(calls).slice(0, 3).every((call) => call.sql.includes('SET is_client_admin = false'))).toBe(true);
    expect(updates(calls)[3].sql).toContain('SET is_client_admin = true');
  });

  it('stops each loop on a short batch, per tenant', async () => {
    const { knex, calls, remaining } = fakeKnex({
      tenants: ['tenant-1', 'tenant-2'],
      rowCounts: [0, 0, 1, 0],
    });

    await migration.up(knex);

    // One batch per direction per tenant, and nothing left unconsumed.
    expect(updates(calls)).toHaveLength(4);
    expect(remaining).toEqual([]);
    expect(new Set(updates(calls).map((call) => call.bindings[0]))).toEqual(new Set(['tenant-1', 'tenant-2']));
  });

  it('is a no-op before the tables exist', async () => {
    const { knex, calls } = fakeKnex({ tenants: ['tenant-1'], rowCounts: [] });
    knex.schema = { hasTable: async (table: string) => table !== 'user_roles' };

    await migration.up(knex);

    expect(calls).toEqual([]);
  });
});
