import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The effective-location rule, which is what every ticket-creation path falls back on. Tested
 * against an in-memory tenant database because the whole point of the rule is which row it picks,
 * and that is only legible as state.
 */

type Row = Record<string, any>;
const state: Record<string, Row[]> = {};

function table(name: string): Row[] {
  if (!state[name]) state[name] = [];
  return state[name];
}

function valueOf(row: Row, key: string): any {
  if (key in row) return row[key];
  const bare = key.includes('.') ? key.slice(key.indexOf('.') + 1) : key;
  return row[bare];
}

class FakeBuilder {
  private predicates: Array<(row: Row) => boolean> = [];
  private joins: Array<{ table: string; left: string; right: string }> = [];
  private orders: Array<{ column: string; direction: string }> = [];

  constructor(private readonly expression: string, private readonly tenant: string) {
    this.predicates.push((row) => row.tenant === this.tenant);
  }

  private get tableName() {
    return this.expression.split(' as ')[0];
  }

  addJoin(join: { table: string; left: string; right: string }) {
    this.joins.push(join);
    return this;
  }

  where(criteria: Row | string, value?: any) {
    if (typeof criteria === 'string') {
      this.predicates.push((row) => valueOf(row, criteria) === value);
    } else {
      this.predicates.push((row) => Object.entries(criteria).every(([key, expected]) => valueOf(row, key) === expected));
    }
    return this;
  }

  orderBy(column: any, direction = 'asc') {
    const entries = Array.isArray(column) ? column : [{ column, order: direction }];
    for (const entry of entries) this.orders.push({ column: entry.column, direction: entry.order ?? 'asc' });
    return this;
  }

  select(..._columns: any[]) {
    return this;
  }

  async first(_columns?: any) {
    return this.resolve()[0];
  }

  then<T1 = any, T2 = never>(
    onFulfilled?: ((value: any) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return Promise.resolve(this.resolve()).then(onFulfilled, onRejected);
  }

  private resolve(): Row[] {
    let candidates: Row[] = table(this.tableName);

    if (this.joins.length > 0) {
      candidates = candidates.map((row) => {
        const merged: Row = { ...row };
        for (const join of this.joins) {
          const joinedTable = join.table.split(' as ')[0];
          const leftColumn = join.left.split('.')[1];
          const rightColumn = join.right.split('.')[1];
          const match = table(joinedTable).find(
            (joinedRow) => joinedRow.tenant === row.tenant && joinedRow[leftColumn] === row[rightColumn],
          );
          if (!match) return null as unknown as Row;
          for (const [column, value] of Object.entries(match)) {
            if (!(column in merged)) merged[column] = value;
          }
        }
        return merged;
      }).filter(Boolean);
    }

    let matched = candidates.filter((row) => this.predicates.every((predicate) => predicate(row)));
    for (const order of [...this.orders].reverse()) {
      matched = [...matched].sort((a, b) => {
        const left = valueOf(a, order.column) ?? '';
        const right = valueOf(b, order.column) ?? '';
        const comparison = left === right ? 0 : left > right ? 1 : -1;
        return order.direction === 'desc' ? -comparison : comparison;
      });
    }
    return matched;
  }
}

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_conn: unknown, tenant: string) => ({
    table: (expression: string) => new FakeBuilder(expression, tenant),
    tenantJoin: (builder: any, joinTable: string, left: string, right: string) =>
      builder.addJoin({ table: joinTable, left, right }),
  }),
}));

import { resolveContactLocationId } from './contactLocation';

const TENANT = 'tenant-1';
const trx = {} as never;

function seed() {
  for (const key of Object.keys(state)) delete state[key];

  table('contacts').push(
    { tenant: TENANT, contact_name_id: 'ada', client_id: 'acme', work_arrangement: null },
    { tenant: TENANT, contact_name_id: 'bob', client_id: 'acme', work_arrangement: 'remote' },
    { tenant: TENANT, contact_name_id: 'cal', client_id: 'nodefault', work_arrangement: 'hybrid' },
    { tenant: TENANT, contact_name_id: 'dot', client_id: null, work_arrangement: null },
  );
  table('client_locations').push(
    { tenant: TENANT, location_id: 'warehouse', client_id: 'acme', location_name: 'Warehouse', is_active: true, is_default: false },
    { tenant: TENANT, location_id: 'head-office', client_id: 'acme', location_name: 'Head office', is_active: true, is_default: true },
    { tenant: TENANT, location_id: 'old-depot', client_id: 'acme', location_name: 'Old depot', is_active: false, is_default: false },
    { tenant: TENANT, location_id: 'dormant', client_id: 'nodefault', location_name: 'Dormant', is_active: false, is_default: false },
  );
  table('contact_locations');
}

const link = (contactId: string, locationId: string, isPrimary = false) =>
  table('contact_locations').push({ tenant: TENANT, contact_name_id: contactId, location_id: locationId, is_primary: isPrimary });

beforeEach(seed);

describe('resolveContactLocationId', () => {
  it('returns the primary link when several exist', async () => {
    link('ada', 'head-office');
    link('ada', 'warehouse', true);
    expect(await resolveContactLocationId(trx, TENANT, 'ada')).toBe('warehouse');
  });

  it('returns the only link even without the primary flag', async () => {
    link('ada', 'warehouse');
    expect(await resolveContactLocationId(trx, TENANT, 'ada')).toBe('warehouse');
  });

  it('falls back to the client default active location when there are no links', async () => {
    expect(await resolveContactLocationId(trx, TENANT, 'ada')).toBe('head-office');
  });

  it('returns null for a remote contact even when the client has a default', async () => {
    link('bob', 'warehouse', true);
    expect(await resolveContactLocationId(trx, TENANT, 'bob')).toBeNull();
  });

  it('returns null when the client has no active default', async () => {
    expect(await resolveContactLocationId(trx, TENANT, 'cal')).toBeNull();
  });

  it('ignores a link to a deactivated location and falls back to the default', async () => {
    link('ada', 'old-depot', true);
    expect(await resolveContactLocationId(trx, TENANT, 'ada')).toBe('head-office');
  });

  it('returns null for a contact with no client and for an unknown contact', async () => {
    expect(await resolveContactLocationId(trx, TENANT, 'dot')).toBeNull();
    expect(await resolveContactLocationId(trx, TENANT, 'ghost')).toBeNull();
  });

  it('never resolves across tenants', async () => {
    link('ada', 'warehouse', true);
    expect(await resolveContactLocationId(trx, 'tenant-2', 'ada')).toBeNull();
  });

  it('treats hybrid like on-site: the link still wins', async () => {
    link('cal', 'dormant', true);
    // The only link is inactive, so there is nothing to send anyone to.
    expect(await resolveContactLocationId(trx, TENANT, 'cal')).toBeNull();
  });
});
