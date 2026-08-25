/**
 * Behaviour contract for the standard-reference-data importer.
 *
 * Four settings screens drive this action (boards, ticket categories, project
 * task statuses, project statuses). It copies rows out of the shared standard
 * library into the tenant's own tables, so a mis-resolved conflict here shows up
 * later as a duplicate status nobody can explain.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTenantKnexMock = vi.hoisted(() => vi.fn());
const withTransactionMock = vi.hoisted(() => vi.fn());
const publishEventMock = vi.hoisted(() => vi.fn());

/** Rows each table should return, keyed by table name. */
const tables = vi.hoisted(() => new Map<string, any[]>());

/**
 * Chainable, awaitable query stub. Builder methods return the builder; awaiting
 * it yields the rows registered for its table, `.first()` yields the head, and
 * an insert echoes its payload back so `.returning()` behaves like Postgres.
 */
function queryFor(table: string): any {
  let pending: any[] | null = null;
  const rows = () => pending ?? tables.get(table) ?? [];

  const builder: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          return (resolve: (v: any) => unknown) => resolve(rows());
        }
        if (prop === 'first') return async () => rows()[0];
        if (prop === 'insert') {
          return (payload: any) => {
            pending = Array.isArray(payload) ? payload : [payload];
            return builder;
          };
        }
        return () => builder;
      },
    },
  );
  return builder;
}

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock,
  tenantDb: () => ({ table: (name: string) => queryFor(name) }),
  withTransaction: withTransactionMock,
}));

vi.mock('@alga-psa/core/server', () => ({ deleteEntityWithValidation: vi.fn() }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: publishEventMock }));

import { importReferenceData } from './referenceDataActions';

/** knex is callable — `db('standard_priorities')` — as well as an object. */
function makeKnex() {
  const knex: any = (table: string) => queryFor(table);
  knex.raw = () => queryFor('__raw__');
  knex.fn = { now: () => new Date().toISOString() };
  return knex;
}

beforeEach(() => {
  vi.clearAllMocks();
  tables.clear();
  const knex = makeKnex();
  createTenantKnexMock.mockResolvedValue({ knex, tenant: 'tenant-1' });
  withTransactionMock.mockImplementation(async (_db: unknown, cb: any) => cb(knex));
});

describe('required filters', () => {
  it('refuses to import categories without a board', async () => {
    // Categories live under a board; importing without one would strand them.
    await expect(importReferenceData('categories', undefined, {})).rejects.toThrow(/Board ID is required/i);
  });

  it('refuses to import ticket statuses without a board', async () => {
    await expect(
      importReferenceData('statuses', undefined, { item_type: 'ticket' }),
    ).rejects.toThrow(/Board ID is required/i);
  });

  it('allows non-ticket statuses without a board', async () => {
    tables.set('standard_statuses', []);
    await expect(
      importReferenceData('statuses', undefined, { item_type: 'project_task' }),
    ).resolves.toBeDefined();
  });

  it('validates before opening a database connection', async () => {
    await importReferenceData('categories', undefined, {}).catch(() => undefined);
    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });
});

describe('selection', () => {
  it('imports only the ids the caller selected', async () => {
    tables.set('standard_priorities', [
      { priority_id: 'p1', priority_name: 'Low', order_number: 1, item_type: 'ticket' },
      { priority_id: 'p2', priority_name: 'High', order_number: 2, item_type: 'ticket' },
    ]);
    tables.set('priorities', []);

    const result: any = await importReferenceData('priorities', ['p2']);

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].priority_name).toBe('High');
  });

  it('imports everything available when no ids are given', async () => {
    tables.set('standard_priorities', [
      { priority_id: 'p1', priority_name: 'Low', order_number: 1, item_type: 'ticket' },
      { priority_id: 'p2', priority_name: 'High', order_number: 2, item_type: 'ticket' },
    ]);
    tables.set('priorities', []);

    const result: any = await importReferenceData('priorities');

    expect(result.imported).toHaveLength(2);
  });
});

describe('conflict resolutions', () => {
  const onePriority = () => {
    tables.set('standard_priorities', [
      { priority_id: 'p1', priority_name: 'Urgent', order_number: 1, item_type: 'ticket' },
    ]);
    tables.set('priorities', []);
  };

  it('skips an item the operator chose to skip, and says why', async () => {
    onePriority();

    const result: any = await importReferenceData('priorities', ['p1'], undefined, {
      p1: { action: 'skip' },
    });

    expect(result.imported).toHaveLength(0);
    expect(result.skipped).toEqual([{ name: 'Urgent', reason: 'Skipped by user' }]);
  });

  it('applies a rename to the field that names this kind of item', async () => {
    onePriority();

    const result: any = await importReferenceData('priorities', ['p1'], undefined, {
      p1: { action: 'rename', newName: 'Critical' },
    });

    expect(result.imported[0].priority_name).toBe('Critical');
  });

  it('applies a reorder to the order field this kind of item uses', async () => {
    onePriority();

    const result: any = await importReferenceData('priorities', ['p1'], undefined, {
      p1: { action: 'reorder', newOrder: 42 },
    });

    expect(result.imported[0].order_number).toBe(42);
  });

  it('skips an item whose name already exists in the tenant', async () => {
    tables.set('standard_priorities', [
      { priority_id: 'p1', priority_name: 'Urgent', order_number: 1, item_type: 'ticket' },
    ]);
    // A row already present under that name makes conflictCheck report a clash.
    tables.set('priorities', [{ priority_name: 'Urgent', item_type: 'ticket' }]);

    const result: any = await importReferenceData('priorities', ['p1']);

    expect(result.imported).toHaveLength(0);
    expect(result.skipped).toEqual([{ name: 'Urgent', reason: 'Already exists' }]);
  });

  it('lets an explicit rename proceed past the duplicate check', async () => {
    // The operator has already been shown the clash and answered it; re-running
    // the name check would skip the row they just resolved.
    tables.set('standard_priorities', [
      { priority_id: 'p1', priority_name: 'Urgent', order_number: 1, item_type: 'ticket' },
    ]);
    tables.set('priorities', [{ priority_name: 'Urgent', item_type: 'ticket' }]);

    const result: any = await importReferenceData('priorities', ['p1'], undefined, {
      p1: { action: 'rename', newName: 'Urgent (imported)' },
    });

    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].priority_name).toBe('Urgent (imported)');
  });
});

describe('tenant scoping', () => {
  it('stamps the caller\'s tenant and user on every imported row', async () => {
    tables.set('standard_priorities', [
      { priority_id: 'p1', priority_name: 'Urgent', order_number: 1, item_type: 'ticket' },
    ]);
    tables.set('priorities', []);

    const result: any = await importReferenceData('priorities', ['p1']);

    expect(result.imported[0]).toMatchObject({ tenant: 'tenant-1', created_by: 'user-1' });
  });
});
