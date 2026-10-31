import { beforeEach, describe, expect, it, vi } from 'vitest';

const sql = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, any>>>,
  counts: { users: 0, invitations: 0 },
  log: [] as string[],
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_conn: unknown, tenant: string) => ({
    table: (spec: string) => {
      const name = spec.split(' as ')[0];
      let lock = '';
      let counting = false;
      const filters: Array<(row: Record<string, any>) => boolean> = [(row) => row.tenant === tenant];
      const api: any = new Proxy({}, {
        get: (_t, method: string) => {
          if (method === 'then') return undefined;
          return (...args: any[]) => {
            if (method === 'where' || method === 'whereNot') {
              const entries = typeof args[0] === 'string' ? (args.length >= 2 ? [[args[0], args[args.length - 1]]] : []) : Object.entries(args[0] ?? {});
              const negate = method === 'whereNot';
              filters.push(row => entries.every(([k, v]) => (negate ? row[k as string] !== v : row[k as string] === v)));
            }
            if (method === 'forUpdate') lock = ' FOR UPDATE';
            if (method === 'forShare') lock = ' FOR SHARE';
            if (method === 'forNoKeyUpdate') lock = ' FOR NO KEY UPDATE';
            if (method === 'count' || method === 'countDistinct') counting = true;
            if (method === 'update') { sql.updates.push({ table: name, values: args[0] }); return Promise.resolve(1); }
            if (method === 'first') {
              sql.log.push(`${tenant === 'sponsor' ? 'S:' : ''}${name}${lock}`);
              if (counting) return Promise.resolve({ count: name === 'users' ? sql.counts.users : sql.counts.invitations });
              return Promise.resolve((sql.rows[name] ?? []).find(row => filters.every(f => f(row))));
            }
            return api;
          };
        },
      });
      return api;
    },
  }),
}));

const entitlement = vi.hoisted(() => ({ state: { capacity: 10, allocated: 2, available: 8, canGrow: true, isReadOnly: false, graceEndsAt: null as string | null } }));
vi.mock('./co-managed-entitlements', () => ({ getCoManagedEntitlementState: async () => entitlement.state }));

import {
  CoManagedAdmissionError,
  assertCoManagedSeatAdmission,
  changeCoManagedAllocation,
  lockCoManagedSeatScope,
} from './co-managed-admission';

const customer = '00000000-0000-4000-8000-0000000000c1';
const sponsor = '00000000-0000-4000-8000-0000000000a1';
const rel = '00000000-0000-4000-8000-0000000000b1';
const op = '00000000-0000-4000-8000-0000000000d1';
const alloc = '00000000-0000-4000-8000-0000000000e1';
const trx: any = { isTransaction: true, raw: (s: string) => s, fn: { now: () => 'now()' } };

function seed(overrides: { relationshipState?: string; operationState?: string; seats?: number; ownerProduct?: string } = {}) {
  sql.rows = {
    tenants: [{ tenant: customer, product_code: 'co_managed' }, { tenant: sponsor, product_code: overrides.ownerProduct ?? 'psa', plan: 'pro' }],
    co_management_relationships: [{ tenant: customer, relationship_id: rel, sponsor_tenant: sponsor, state: overrides.relationshipState ?? 'active', ended_at: null }],
    co_managed_entitlements: [{ tenant: sponsor, source: 'admin_grant' }],
    co_managed_provisioning_operations: [{ tenant: sponsor, customer_tenant: customer, relationship_id: rel, operation_id: op, allocation_id: alloc, state: overrides.operationState ?? 'pending_acceptance' }],
    co_managed_allocations: [{ tenant: sponsor, allocation_id: alloc, customer_tenant: customer, relationship_id: rel, seats: overrides.seats ?? 3, state: 'active' }],
  };
}

// The mock keys tenant scoping on the tenant string; re-key the sponsor rows via their tenant value.
beforeEach(() => {
  sql.log = [];
  sql.updates = [];
  sql.counts = { users: 0, invitations: 0 };
  entitlement.state = { capacity: 10, allocated: 2, available: 8, canGrow: true, isReadOnly: false, graceEndsAt: null };
  seed();
});

describe('lockCoManagedSeatScope', () => {
  it('returns null for a workspace that is not co-managed, touching only its own row', async () => {
    sql.rows.tenants[0].product_code = 'psa';
    expect(await lockCoManagedSeatScope(trx, customer)).toBeNull();
    expect(sql.log).toEqual(['tenants']);
  });

  it('locks in the plan order: entitlement, sponsor tenant, operation, relationship, customer tenant', async () => {
    const scope = await lockCoManagedSeatScope(trx, customer);
    expect(scope?.sponsorTenant).toBe(sponsor);
    expect(sql.log).toEqual([
      'tenants', 'co_management_relationships',
      'co_managed_entitlements FOR UPDATE', 'tenants FOR SHARE',
      'co_managed_provisioning_operations FOR UPDATE', 'co_management_relationships FOR UPDATE',
      'co_managed_allocations', 'tenants FOR NO KEY UPDATE',
    ]);
  });

  it('refuses when the operation has not reached pending_acceptance', async () => {
    seed({ operationState: 'provisioning' });
    await expect(lockCoManagedSeatScope(trx, customer)).rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
  });

  it('refuses when the allocation is released', async () => {
    sql.rows.co_managed_allocations[0].state = 'released';
    await expect(lockCoManagedSeatScope(trx, customer)).rejects.toMatchObject({ code: 'CO_MANAGED_ALLOCATION_CONFLICT' });
  });
});

describe('assertCoManagedSeatAdmission', () => {
  it('is a no-op for a native (non co-managed) tenant', async () => {
    sql.rows.tenants[0].product_code = 'psa';
    expect(await assertCoManagedSeatAdmission(trx, customer)).toEqual({ managed: false });
  });

  it('admits under the allocation', async () => {
    sql.counts = { users: 1, invitations: 1 };
    expect(await assertCoManagedSeatAdmission(trx, customer, { email: 'a@example.com' })).toEqual({ managed: true });
  });

  it('refuses at the seat limit', async () => {
    sql.counts = { users: 2, invitations: 1 };
    await expect(assertCoManagedSeatAdmission(trx, customer, { email: 'a@example.com' }))
      .rejects.toMatchObject({ name: 'CoManagedAdmissionError', code: 'CO_MANAGED_SEAT_LIMIT' });
  });

  it('refuses before acceptance unless it is the initial administrator', async () => {
    seed({ relationshipState: 'pending_acceptance' });
    await expect(assertCoManagedSeatAdmission(trx, customer, { email: 'a@example.com' }))
      .rejects.toMatchObject({ code: 'CO_MANAGED_NOT_ACTIVE' });
  });

  it('refuses when the sponsor is no longer a psa tenant', async () => {
    seed({ ownerProduct: 'algadesk' });
    await expect(assertCoManagedSeatAdmission(trx, customer, { email: 'a@example.com' }))
      .rejects.toMatchObject({ code: 'CO_MANAGED_LICENSE_LAPSED' });
  });

  it.each([
    ['grace', { graceEndsAt: '2026-12-01T00:00:00.000Z' }],
    ['read-only', { isReadOnly: true }],
    ['over-allocated', { capacity: 1, allocated: 2 }],
  ])('refuses while the entitlement is %s', async (_name, patch) => {
    entitlement.state = { ...entitlement.state, ...patch };
    await expect(assertCoManagedSeatAdmission(trx, customer, { email: 'a@example.com' }))
      .rejects.toMatchObject({ code: 'CO_MANAGED_LICENSE_LAPSED' });
  });
});

describe('changeCoManagedAllocation', () => {
  const db: any = { transaction: async (work: (t: any) => unknown) => work(trx) };

  it('rejects out-of-range seat counts before any SQL', async () => {
    await expect(changeCoManagedAllocation(db, sponsor, { customerTenant: customer, relationshipId: rel, seats: 0, expectedSeats: 3 }))
      .rejects.toBeInstanceOf(CoManagedAdmissionError);
    expect(sql.log).toEqual([]);
  });

  it('refuses a stale expectedSeats', async () => {
    await expect(changeCoManagedAllocation(db, sponsor, { customerTenant: customer, relationshipId: rel, seats: 5, expectedSeats: 4 }))
      .rejects.toMatchObject({ code: 'CO_MANAGED_ALLOCATION_CONFLICT' });
  });

  it('refuses growth beyond the pool', async () => {
    entitlement.state = { ...entitlement.state, available: 1 };
    await expect(changeCoManagedAllocation(db, sponsor, { customerTenant: customer, relationshipId: rel, seats: 5, expectedSeats: 3 }))
      .rejects.toMatchObject({ code: 'CO_MANAGED_POOL_LIMIT' });
  });

  it('never evicts: shrinking below committed seats is refused', async () => {
    sql.counts = { users: 3, invitations: 0 };
    await expect(changeCoManagedAllocation(db, sponsor, { customerTenant: customer, relationshipId: rel, seats: 2, expectedSeats: 3 }))
      .rejects.toMatchObject({ code: 'CO_MANAGED_SEAT_LIMIT' });
    expect(sql.updates).toEqual([]);
  });

  it('writes the allocation and the customer licensed_user_count together', async () => {
    await changeCoManagedAllocation(db, sponsor, { customerTenant: customer, relationshipId: rel, seats: 5, expectedSeats: 3 });
    expect(sql.updates.map(update => update.table)).toEqual(['co_managed_allocations', 'tenants']);
    expect(sql.updates[1].values).toEqual({ licensed_user_count: 5 });
  });
});
