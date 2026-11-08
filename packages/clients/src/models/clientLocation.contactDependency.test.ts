import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Deleting a location that contacts are linked to. The database already refuses it
 * (contact_locations is ON DELETE RESTRICT); the model counts first so the operator reads
 * "it has associated 2 contact(s)" rather than a foreign-key error, and so the count sits beside
 * the ticket and tax-rate counts in one sentence.
 *
 * Deactivating the same location is deliberately untouched: the links stay and the contact read
 * reports the location as inactive.
 */

type Row = Record<string, any>;
const state: Record<string, Row[]> = {};

function table(name: string): Row[] {
  if (!state[name]) state[name] = [];
  return state[name];
}

class FakeBuilder {
  private predicates: Array<(row: Row) => boolean> = [];
  private counting = false;

  constructor(private readonly tableName: string, private readonly tenant: string) {
    this.predicates.push((row) => row.tenant === this.tenant);
  }

  where(criteria: Row | string, value?: any) {
    if (typeof criteria === 'string') {
      this.predicates.push((row) => row[criteria] === value);
    } else {
      this.predicates.push((row) => Object.entries(criteria).every(([key, expected]) => row[key] === expected));
    }
    return this;
  }

  whereNot(column: string, value: any) {
    this.predicates.push((row) => row[column] !== value);
    return this;
  }

  select(..._columns: any[]) {
    return this;
  }

  forUpdate() {
    return this;
  }

  orderBy(..._args: any[]) {
    return this;
  }

  count(_expression: string) {
    this.counting = true;
    return this;
  }

  returning(..._columns: any[]) {
    return this;
  }

  async first(..._columns: any[]) {
    const rows = this.resolve();
    return this.counting ? { count: String(rows.length) } : rows[0];
  }

  then<T1 = any, T2 = never>(
    onFulfilled?: ((value: any) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return Promise.resolve(this.resolve()).then(onFulfilled, onRejected);
  }

  update(patch: Row) {
    const apply = () => {
      const matched = this.resolve();
      for (const row of matched) Object.assign(row, patch);
      return matched;
    };
    // Knex defers the write until the builder is awaited, and `.returning()` chains onto it.
    return {
      returning: (..._columns: any[]) => Promise.resolve(apply()),
      then: <T1, T2>(
        onFulfilled?: ((value: any) => T1 | PromiseLike<T1>) | null,
        onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
      ) => Promise.resolve(apply().length).then(onFulfilled, onRejected),
    };
  }

  async delete(): Promise<number> {
    const matched = new Set(this.resolve());
    const rows = table(this.tableName);
    const remaining = rows.filter((row) => !matched.has(row));
    const removed = rows.length - remaining.length;
    rows.length = 0;
    rows.push(...remaining);
    return removed;
  }

  private resolve(): Row[] {
    return table(this.tableName).filter((row) => this.predicates.every((predicate) => predicate(row)));
  }
}

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_conn: unknown, tenant: string) => ({
    table: (name: string) => new FakeBuilder(name, tenant),
  }),
}));

vi.mock('../lib/clientLocationEvents', () => ({
  queueClientLocationCreated: vi.fn(),
  queueClientLocationUpdated: vi.fn(),
  queueClientLocationDeleted: vi.fn(),
}));

import { deleteLocation, updateLocation } from './clientLocation';

const TENANT = 'tenant-1';
const trx = { fn: { now: () => 'now()' } } as never;

function seed() {
  for (const key of Object.keys(state)) delete state[key];
  table('clients').push({ tenant: TENANT, client_id: 'acme' });
  table('client_locations').push(
    { tenant: TENANT, location_id: 'warehouse', client_id: 'acme', location_name: 'Warehouse', is_active: true, is_default: false },
    { tenant: TENANT, location_id: 'head-office', client_id: 'acme', location_name: 'Head office', is_active: true, is_default: true },
  );
  table('tickets');
  table('client_tax_rates');
  table('contact_locations');
}

beforeEach(seed);

describe('deleteLocation contact dependency', () => {
  it('refuses the delete with the contact count and leaves the location in place', async () => {
    table('contact_locations').push(
      { tenant: TENANT, contact_name_id: 'ada', location_id: 'warehouse', is_primary: true },
      { tenant: TENANT, contact_name_id: 'bob', location_id: 'warehouse', is_primary: true },
    );

    await expect(deleteLocation(trx, TENANT, 'acme', 'warehouse'))
      .rejects.toThrow('Cannot delete location: it has associated 2 contact(s)');
    expect(table('client_locations').some((row) => row.location_id === 'warehouse')).toBe(true);
  });

  it('lists contacts beside tickets and tax rates when all three apply', async () => {
    table('tickets').push({ tenant: TENANT, ticket_id: 't1', location_id: 'warehouse' });
    table('contact_locations').push({ tenant: TENANT, contact_name_id: 'ada', location_id: 'warehouse' });
    table('client_tax_rates').push({ tenant: TENANT, tax_rate_id: 'r1', location_id: 'warehouse' });

    await expect(deleteLocation(trx, TENANT, 'acme', 'warehouse'))
      .rejects.toThrow('Cannot delete location: it has associated 1 ticket(s) and 1 contact(s) and 1 tax rate(s)');
  });

  it('deletes a location nobody is linked to', async () => {
    await deleteLocation(trx, TENANT, 'acme', 'warehouse');
    expect(table('client_locations').some((row) => row.location_id === 'warehouse')).toBe(false);
  });

  it('keeps the links when the location is deactivated instead', async () => {
    table('contact_locations').push({ tenant: TENANT, contact_name_id: 'ada', location_id: 'warehouse' });

    await updateLocation(trx, TENANT, 'acme', 'warehouse', { is_active: false });

    expect(table('client_locations').find((row) => row.location_id === 'warehouse')).toMatchObject({ is_active: false });
    expect(table('contact_locations')).toHaveLength(1);
  });

  it('never counts another tenant\'s links', async () => {
    table('contact_locations').push({ tenant: 'tenant-2', contact_name_id: 'eve', location_id: 'warehouse' });

    await deleteLocation(trx, TENANT, 'acme', 'warehouse');
    expect(table('client_locations').some((row) => row.location_id === 'warehouse')).toBe(false);
  });
});
