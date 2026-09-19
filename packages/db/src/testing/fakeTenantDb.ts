import { fakeQueryBuilder, type FakeQueryBuilderOptions, type FakeRow } from './fakeQueryBuilder';

/**
 * Table-dispatching doubles for `tenantDb` / `tenantScopedTable`.
 *
 * The default that matters: a table nobody modelled resolves to an *empty*
 * table rather than throwing, and the `tenants` table defaults to an
 * independent PSA workspace. Co-managed lifecycle admission reads
 * `tenants.product_code` on every operational write; with the old
 * throw-on-unknown-table fakes, that one read turned ~30 unrelated suites red
 * with `Unexpected table tenants`. An independent PSA tenant makes
 * `readState` return `{ state: 'independent', canWrite: true }` and step out of
 * the way, which is what a test about ticket bundling or calendar sync actually
 * means when it says nothing about co-management.
 *
 * A test that *is* about co-management opts in by declaring the rows.
 */

export interface FakeTenantTables {
  /** `table name -> rows`, or `'tenant:table' -> rows` when multi-tenant. */
  [table: string]: FakeRow[];
}

export interface FakeTenantDbOptions extends Omit<FakeQueryBuilderOptions, 'rows'> {
  tables?: FakeTenantTables;
  /**
   * Throw on a table with no declared rows instead of returning an empty one.
   * Only worth turning on for a test whose subject *is* the set of tables a
   * function touches.
   */
  strict?: boolean;
  /** Overrides the default `{ product_code: 'psa' }` tenants row. */
  tenantRow?: FakeRow | null;
  /** Per-table builder options, keyed by table name. */
  perTable?: Record<string, Omit<FakeQueryBuilderOptions, 'rows'>>;
}

/** A workspace that is not co-managed, so lifecycle admission is a no-op. */
export const INDEPENDENT_TENANT_ROW: FakeRow = { product_code: 'psa', plan: 'pro' };

function rowsFor(options: FakeTenantDbOptions, tenant: string | undefined, table: string): FakeRow[] | undefined {
  const tables = options.tables ?? {};
  const scoped = tenant ? tables[`${tenant}:${table}`] : undefined;
  if (scoped) return scoped;
  if (tables[table]) return tables[table];
  if (table === 'tenants') {
    if (options.tenantRow === null) return [];
    return [options.tenantRow ?? INDEPENDENT_TENANT_ROW];
  }
  return undefined;
}

/** Build the query double for one table, honouring strict mode. */
export function fakeTable(options: FakeTenantDbOptions, tenant: string | undefined, table: string) {
  const rows = rowsFor(options, tenant, table);
  if (rows === undefined && options.strict) {
    throw new Error(`fakeTenantDb: no rows declared for table "${table}"`);
  }
  const { tables: _tables, strict: _strict, tenantRow: _tenantRow, perTable, ...shared } = options;
  return fakeQueryBuilder({ ...shared, ...(perTable?.[table] ?? {}), rows: rows ?? [] });
}

/** Stand-in for `tenantDb(trx, tenant)`. */
export function fakeTenantDb(options: FakeTenantDbOptions = {}) {
  return (_db: unknown, tenant?: string) => ({
    table: (table: string) => fakeTable(options, tenant, table),
  });
}

/** Stand-in for `tenantScopedTable(trx, table, tenant)`. */
export function fakeTenantScopedTable(options: FakeTenantDbOptions = {}) {
  return (_db: unknown, table: string, tenant?: string) =>
    // knex accepts `'tickets as t'`; the fakes key on the bare table name.
    fakeTable(options, tenant, table.split(' ')[0]);
}

/**
 * A transaction double that satisfies `trx.isTransaction`.
 *
 * `assertCoManagedOperationalWrite` refuses a bare connection, so a
 * `withTransaction` double that yields a plain object fails every write path
 * with `Operational lifecycle admission requires an open transaction`.
 */
export function fakeTransaction(extra: FakeRow = {}): FakeRow {
  return { isTransaction: true, fn: { now: () => 'now()' }, ...extra };
}

/** `withTransaction` double that hands the callback a real-looking transaction. */
export function fakeWithTransaction(trx: FakeRow = fakeTransaction()) {
  return async (_db: unknown, callback: (trx: FakeRow) => unknown) => callback(trx);
}
