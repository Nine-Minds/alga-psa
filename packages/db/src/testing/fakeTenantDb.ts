import { fakeQueryBuilder, type FakeQueryBuilder, type FakeQueryBuilderOptions, type FakeRow } from './fakeQueryBuilder';

/**
 * Table-dispatching doubles for `tenantDb` / `tenantScopedTable`.
 *
 * Two properties matter to the tests built on these:
 *
 * 1. A table nobody modelled resolves to an *empty* table rather than throwing,
 *    so a helper that starts reading one more table does not turn unrelated
 *    suites red. (`strict` restores the throw for a test whose subject is the
 *    set of tables a function touches.)
 * 2. The doubles **record what was actually used**: every table access keeps the
 *    tenant it was scoped to and the exact database handle (connection or
 *    transaction) it was opened on, and the builder keeps the filters applied.
 *    A test can therefore fail when a query escapes its transaction or drops its
 *    tenant predicate, instead of only asserting on returned rows.
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
  /** Per-table builder options, keyed by table name. */
  perTable?: Record<string, Omit<FakeQueryBuilderOptions, 'rows'>>;
}

/** One table access made through a fake. */
export interface FakeTableCall {
  table: string;
  /** The tenant the access was scoped to (`undefined` if the caller passed none). */
  tenant: string | undefined;
  /** The exact handle the access was opened on (a connection or a transaction). */
  handle: unknown;
  /** The builder returned; `builder.filters` lists the filters applied to it. */
  builder: FakeQueryBuilder;
}

export interface FakeCallLog {
  /** Every table access, in call order. */
  readonly calls: FakeTableCall[];
}

function rowsFor(options: FakeTenantDbOptions, tenant: string | undefined, table: string): FakeRow[] | undefined {
  const tables = options.tables ?? {};
  const scoped = tenant ? tables[`${tenant}:${table}`] : undefined;
  return scoped ?? tables[table];
}

/** Build the query double for one table, honouring strict mode. */
export function fakeTable(options: FakeTenantDbOptions, tenant: string | undefined, table: string) {
  const rows = rowsFor(options, tenant, table);
  if (rows === undefined && options.strict) {
    throw new Error(`fakeTenantDb: no rows declared for table "${table}"`);
  }
  const { tables: _tables, strict: _strict, perTable, ...shared } = options;
  return fakeQueryBuilder({ ...shared, ...(perTable?.[table] ?? {}), rows: rows ?? [] });
}

/** Stand-in for `tenantDb(trx, tenant)`. The returned function carries the call log. */
export function fakeTenantDb(options: FakeTenantDbOptions = {}) {
  const calls: FakeTableCall[] = [];
  const factory = (db: unknown, tenant?: string) => ({
    table: (table: string) => {
      const builder = fakeTable(options, tenant, table);
      calls.push({ table, tenant, handle: db, builder });
      return builder;
    },
  });
  return Object.assign(factory, { calls }) as typeof factory & FakeCallLog;
}

/** Stand-in for `tenantScopedTable(trx, table, tenant)`. The returned function carries the call log. */
export function fakeTenantScopedTable(options: FakeTenantDbOptions = {}) {
  const calls: FakeTableCall[] = [];
  const factory = (db: unknown, table: string, tenant?: string) => {
    // knex accepts `'tickets as t'`; the fakes key on the bare table name.
    const bare = table.split(' ')[0];
    const builder = fakeTable(options, tenant, bare);
    calls.push({ table: bare, tenant, handle: db, builder });
    return builder;
  };
  return Object.assign(factory, { calls }) as typeof factory & FakeCallLog;
}

/**
 * A transaction double that satisfies `trx.isTransaction`, for code that
 * refuses a bare connection on write paths.
 */
export function fakeTransaction(extra: FakeRow = {}): FakeRow {
  return { isTransaction: true, fn: { now: () => 'now()' }, ...extra };
}

/**
 * `withTransaction` double that hands the callback a real-looking transaction
 * and records the handle it was asked to open on (`opened`) and each
 * transaction it produced (`transactions`).
 */
export function fakeWithTransaction(trx: FakeRow = fakeTransaction()) {
  const opened: unknown[] = [];
  const transactions: FakeRow[] = [];
  const run = async (db: unknown, callback: (trx: FakeRow) => unknown) => {
    opened.push(db);
    transactions.push(trx);
    return callback(trx);
  };
  return Object.assign(run, { opened, transactions });
}
