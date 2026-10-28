import type { Knex } from 'knex';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import {
  parseTableExpression,
  requireTenantTableScope,
  type ParsedTableExpression,
  type TenantTableScope,
} from './tenantTableMetadata';
import { createTenantScopedRootQuery, type TenantScopedQuery } from './tenantScopedQuery';
import { isOperationalWriteTable } from './operationalWriteTables';
import { admitOperationalWrite, admitTenantWrite, isTenantWriteGuarded } from './writeAdmission';

export interface TenantJoinOptions {
  type?: 'inner' | 'left';
  tenantPredicate?: 'root' | 'literal';
  rootTenantColumn?: string;
  on?: (join: Knex.JoinClause) => void;
}

export interface TenantSubqueryJoinOptions {
  type?: 'inner' | 'left';
  rootTenantColumn: string;
  joinedTenantColumn: string;
  on?: (join: Knex.JoinClause) => void;
}

export interface TenantFirstMatchingJoinOptions {
  type?: 'inner' | 'left';
  rootTenantColumn: string;
  where: (query: Knex.QueryBuilder, sourceAlias: string) => void;
  orderBy: ReadonlyArray<{
    column: string;
    order: 'asc' | 'desc';
  }>;
}

// Default row type for facade queries. `any` (not `Record<string, any>`) is
// deliberate: knex narrows `.select('alias.col')` over a Record to
// `Pick<Record, "alias.col">`, keying the row by the literal alias-qualified
// string — but Postgres returns the column unprefixed (`col`), so `row.col`
// would not typecheck. With `any`, `.select(...)` does not narrow and rows stay
// untyped (they already were value-wise). Opt into precise typing per call with
// `db.table<Row>(...)` or knex object-form selects (`.select({ col: 'a.col' })`).
type DynamicTenantRow = any;

export interface TenantDb {
  readonly tenant: string;
  table<Row extends object = DynamicTenantRow>(tableExpression: string): Knex.QueryBuilder<Row, Row[]>;
  parentScopedTable<Row extends object = DynamicTenantRow>(tableExpression: string): Knex.QueryBuilder<Row, Row[]>;
  insertParentScoped<Row extends object = DynamicTenantRow>(
    tableExpression: string,
    values: Row | readonly Row[],
    returning?: string | readonly string[]
  ): Promise<Row[]>;
  scoped(tableExpression: string): TenantScopedQuery;
  subquery<Row extends object = DynamicTenantRow>(tableExpression: string): Knex.QueryBuilder<Row, Row[]>;
  tenantJoin(
    builder: Knex.QueryBuilder,
    tableExpression: string,
    left: string,
    right: string,
    options?: TenantJoinOptions
  ): Knex.QueryBuilder;
  tenantJoinSubquery(
    builder: Knex.QueryBuilder,
    subquery: Knex.QueryBuilder,
    left: string,
    right: string,
    options: TenantSubqueryJoinOptions
  ): Knex.QueryBuilder;
  tenantJoinFirstMatching(
    builder: Knex.QueryBuilder,
    tableName: string,
    alias: string,
    rootParentColumn: string,
    childParentColumn: string,
    options: TenantFirstMatchingJoinOptions
  ): Knex.QueryBuilder;
  tenantWhereColumn(
    builder: Knex.QueryBuilder,
    leftTenantColumn: string,
    rightTenantColumn: string
  ): Knex.QueryBuilder;
  unscoped<Row extends object = DynamicTenantRow>(
    tableExpression: string,
    reason: string
  ): Knex.QueryBuilder<Row, Row[]>;
}

/** The builder methods that turn a tenant-scoped builder into a write. */
const WRITE_TERMINALS = ['insert', 'update', 'del', 'delete', 'truncate', 'increment', 'decrement'] as const;
const WRITE_GUARDED = Symbol.for('alga.tenantDb.writeGuarded');

/**
 * Attach write admission to the write terminals of one builder.
 *
 * Reads are untouched: only the terminals above arm the guard, and an armed
 * builder is a thenable whose `then` first awaits admission. Knex routes `catch`,
 * `finally` and `asCallback` through `then`, so one patch covers every way a
 * builder is awaited. `clone()` is re-guarded because knex clones drop own properties.
 *
 * Returns the builder unchanged (no wrapper, no cost) when the table is not an
 * operational one or the tenant is known not to be co-managed.
 */
function guardWrites<B extends Knex.QueryBuilder>(
  builder: B,
  conn: Knex | Knex.Transaction,
  tenant: string,
  tableName: string,
  armedOperation?: string,
): B {
  if (!isOperationalWriteTable(tableName) || !isTenantWriteGuarded(tenant)) return builder;
  const target = builder as any;

  const arm = (result: any, operation: string) => {
    if (!result || result[WRITE_GUARDED]) return result;
    const originalThen = result.then;
    const originalStream = result.stream;
    result[WRITE_GUARDED] = true;
    const admit = () => admitTenantWrite(conn, tenant, { table: tableName, operation: `${operation}:${tableName}` });
    result.then = function guardedThen(onFulfilled?: any, onRejected?: any) {
      return admit().then(() => originalThen.call(result)).then(onFulfilled, onRejected);
    };
    result.stream = function guardedStream(optionsOrHandler?: any, handlerOrNil?: any) {
      const handler = typeof optionsOrHandler === 'function' ? optionsOrHandler : handlerOrNil;
      const options = typeof optionsOrHandler === 'function' ? undefined : optionsOrHandler;
      const output = new PassThrough({ objectMode: true });
      const run = admit().then(() => {
        if (output.destroyed) return;
        const source = originalStream.call(result, options);
        source.on('error', (error: Error) => output.destroy(error));
        output.on('close', () => source.destroy());
        source.pipe(output);
        return finished(source);
      });
      if (typeof handler === 'function') {
        handler(output);
        return run;
      }
      run.catch((error) => output.destroy(error));
      return output;
    };
    result.pipe = function guardedPipe(writable: any, options?: any) {
      return result.stream(options).pipe(writable);
    };
    return result;
  };

  for (const terminal of WRITE_TERMINALS) {
    const original = target[terminal];
    if (typeof original !== 'function') continue;
    target[terminal] = function guardedTerminal(this: any, ...args: unknown[]) {
      const result = original.apply(this, args);
      return arm(result, terminal);
    };
  }

  const originalClone = target.clone;
  target.clone = function guardedClone(this: any, ...args: unknown[]) {
    return guardWrites(originalClone.apply(this, args), conn, tenant, tableName, this[WRITE_GUARDED] ? this._method : undefined);
  };
  if (armedOperation) arm(target, armedOperation);
  return builder;
}

function assertTenant(tenant: string | null | undefined): asserts tenant is string {
  if (!tenant || !tenant.trim()) {
    throw new Error('tenantDb requires a tenant id');
  }
}

function tenantColumn(scope: TenantTableScope): string {
  return scope.scope === 'tenant' ? scope.tenantColumn ?? 'tenant' : 'tenant';
}

function parentAliasFor(parsed: ParsedTableExpression): string {
  return `__${parsed.rootAlias.replace(/[^A-Za-z0-9_]/g, '_')}_tenant_parent`;
}

function normalizeRows<Row extends object>(values: Row | readonly Row[]): Row[] {
  return Array.isArray(values) ? Array.from(values) as Row[] : [values as Row];
}

function rootQualifier(column: string): string | null {
  const match = column.match(/^([^.\s]+)\./);
  return match?.[1] ?? null;
}

function inferRootTenantColumn(parsed: ParsedTableExpression, left: string, right: string): string {
  const leftQualifier = rootQualifier(left);
  const rightQualifier = rootQualifier(right);

  if (leftQualifier === parsed.rootAlias && rightQualifier) {
    return `${rightQualifier}.tenant`;
  }

  if (rightQualifier === parsed.rootAlias && leftQualifier) {
    return `${leftQualifier}.tenant`;
  }

  throw new Error(
    `Unable to infer root tenant column for join to ${parsed.tableExpression}; pass rootTenantColumn`
  );
}

export function tenantDb(conn: Knex | Knex.Transaction, tenantInput: string | null | undefined): TenantDb {
  assertTenant(tenantInput);
  // Capture the narrowed value in a const so the nested closures below (which
  // capture `tenant`) see `string`, not the nullable param re-widened in closures.
  const tenant: string = tenantInput;

  function scoped(tableExpression: string): TenantScopedQuery {
    const parsed = parseTableExpression(tableExpression);
    const scope = requireTenantTableScope(parsed.tableName);

    if (scope.scope === 'global') {
      throw new Error(`Global table ${parsed.tableName} cannot create a tenant-scoped query`);
    }

    if (scope.scope === 'admin') {
      throw new Error(`Admin table ${parsed.tableName} cannot be accessed through tenantDb.scoped`);
    }

    if (scope.scope === 'tenantViaParent') {
      throw new Error(`Parent-scoped child table ${parsed.tableName} must use tenantDb.parentScopedTable`);
    }

    return createTenantScopedRootQuery(conn, {
      table: tableExpression,
      alias: parsed.rootAlias,
      tenant,
      tenantColumn: tenantColumn(scope),
      decorateBuilder: (builder) => guardWrites(builder, conn, tenant, parsed.tableName),
    });
  }

  function table<Row extends object = DynamicTenantRow>(
    tableExpression: string
  ): Knex.QueryBuilder<Row, Row[]> {
    const parsed = parseTableExpression(tableExpression);
    const scope = requireTenantTableScope(parsed.tableName);

    if (scope.scope === 'global') {
      return conn<Row, Row[]>(tableExpression);
    }

    if (scope.scope === 'admin') {
      throw new Error(`Admin table ${parsed.tableName} cannot be accessed through tenantDb.table`);
    }

    if (scope.scope === 'tenantViaParent') {
      throw new Error(`Parent-scoped child table ${parsed.tableName} must use tenantDb.parentScopedTable`);
    }

    return scoped(tableExpression).builder as Knex.QueryBuilder<Row, Row[]>;
  }

  function parentScopedTable<Row extends object = DynamicTenantRow>(
    tableExpression: string
  ): Knex.QueryBuilder<Row, Row[]> {
    const parsed = parseTableExpression(tableExpression);
    const scope = requireTenantTableScope(parsed.tableName);

    if (scope.scope !== 'tenantViaParent') {
      throw new Error(`Table ${parsed.tableName} is not registered as tenant-scoped through a parent`);
    }

    const parentScope = requireTenantTableScope(scope.parentTable);
    if (parentScope.scope !== 'tenant') {
      throw new Error(`Parent table ${scope.parentTable} for ${parsed.tableName} must be tenant-scoped`);
    }

    const parentAlias = parentAliasFor(parsed);
    const parentQuery = table(`${scope.parentTable} as ${parentAlias}`)
      .select(conn.raw('1'))
      .whereRaw('?? = ??', [
        `${parentAlias}.${scope.parentColumn}`,
        `${parsed.rootAlias}.${scope.childColumn}`,
      ]);

    return guardWrites(conn<Row, Row[]>(tableExpression).whereExists(parentQuery), conn, tenant, parsed.tableName);
  }

  async function insertParentScoped<Row extends object = DynamicTenantRow>(
    tableExpression: string,
    values: Row | readonly Row[],
    returning: string | readonly string[] = '*'
  ): Promise<Row[]> {
    const parsed = parseTableExpression(tableExpression);
    const scope = requireTenantTableScope(parsed.tableName);

    if (scope.scope !== 'tenantViaParent') {
      throw new Error(`Table ${parsed.tableName} is not registered as tenant-scoped through a parent`);
    }

    if (parsed.rootAlias !== parsed.tableName) {
      throw new Error(`Parent-scoped inserts must target a table name without alias: ${tableExpression}`);
    }

    const parentScope = requireTenantTableScope(scope.parentTable);
    if (parentScope.scope !== 'tenant') {
      throw new Error(`Parent table ${scope.parentTable} for ${parsed.tableName} must be tenant-scoped`);
    }

    const rows = normalizeRows(values);
    if (rows.length === 0) {
      return [];
    }

    await admitOperationalWrite(conn, tenant, parsed.tableName, `insert:${parsed.tableName}`);

    const parentIds = Array.from(new Set(rows.map((row) => (row as Record<string, unknown>)[scope.childColumn])));
    if (parentIds.some((id) => id === null || id === undefined || id === '')) {
      throw new Error(`Parent-scoped insert into ${parsed.tableName} requires ${scope.childColumn}`);
    }

    const foundParentIds = await table<Record<string, unknown>>(scope.parentTable)
      .whereIn(scope.parentColumn, parentIds as readonly any[])
      .pluck(scope.parentColumn);
    const found = new Set(foundParentIds.map((id) => String(id)));
    const missing = parentIds.filter((id) => !found.has(String(id)));

    if (missing.length > 0) {
      throw new Error(`Parent row not found for parent-scoped insert into ${parsed.tableName}`);
    }

    // write-admission: exempt — insertParentScoped admits parsed.tableName before parent validation above.
    const inserted = await conn<Row, Row[]>(tableExpression)
      .insert(values as any)
      .returning(returning as any);
    return inserted as Row[];
  }

  function tenantJoin(
    builder: Knex.QueryBuilder,
    tableExpression: string,
    left: string,
    right: string,
    options: TenantJoinOptions = {}
  ): Knex.QueryBuilder {
    const parsed = parseTableExpression(tableExpression);
    const scope = requireTenantTableScope(parsed.tableName);

    if (scope.scope === 'admin') {
      throw new Error(`Admin table ${parsed.tableName} cannot be joined through tenantDb.tenantJoin`);
    }

    const joinTenantTable = function joinTenantTable(this: Knex.JoinClause) {
      this.on(left, '=', right);

      if (scope.scope === 'tenant') {
        const joinedTenantColumn = `${parsed.rootAlias}.${tenantColumn(scope)}`;

        if (options.tenantPredicate === 'literal') {
          this.andOn(joinedTenantColumn, '=', conn.raw('?', [tenant]));
        } else {
          this.andOn(
            joinedTenantColumn,
            '=',
            options.rootTenantColumn ?? inferRootTenantColumn(parsed, left, right)
          );
        }
      }

      options.on?.(this);
    };

    if (options.type === 'left') {
      return builder.leftJoin(tableExpression, joinTenantTable);
    }

    return builder.join(tableExpression, joinTenantTable);
  }

  function tenantJoinSubquery(
    builder: Knex.QueryBuilder,
    subquery: Knex.QueryBuilder,
    left: string,
    right: string,
    options: TenantSubqueryJoinOptions
  ): Knex.QueryBuilder {
    const joinDerivedTenantQuery = function joinDerivedTenantQuery(this: Knex.JoinClause) {
      this
        .on(left, '=', right)
        .andOn(options.joinedTenantColumn, '=', options.rootTenantColumn);

      options.on?.(this);
    };

    if (options.type === 'left') {
      return builder.leftJoin(subquery, joinDerivedTenantQuery);
    }

    return builder.join(subquery, joinDerivedTenantQuery);
  }

  function tenantJoinFirstMatching(
    builder: Knex.QueryBuilder,
    tableName: string,
    alias: string,
    rootParentColumn: string,
    childParentColumn: string,
    options: TenantFirstMatchingJoinOptions
  ): Knex.QueryBuilder {
    const parsed = parseTableExpression(tableName);
    if (parsed.rootAlias !== parsed.tableName) {
      throw new Error('tenantDb.tenantJoinFirstMatching requires a table name without an alias');
    }
    if (!alias.trim() || !childParentColumn.trim() || options.orderBy.length === 0) {
      throw new Error('tenantDb.tenantJoinFirstMatching requires an alias, parent column, and ordering');
    }

    const sourceAlias = `__${alias}_source`;
    const subquery = table(`${tableName} as ${sourceAlias}`)
      .distinctOn([`${sourceAlias}.tenant`, `${sourceAlias}.${childParentColumn}`])
      .select(`${sourceAlias}.*`)
      .orderBy(`${sourceAlias}.tenant`, 'asc')
      .orderBy(`${sourceAlias}.${childParentColumn}`, 'asc');

    options.where(subquery, sourceAlias);
    for (const ordering of options.orderBy) {
      subquery.orderBy(`${sourceAlias}.${ordering.column}`, ordering.order);
    }

    return tenantJoinSubquery(
      builder,
      subquery.as(alias),
      rootParentColumn,
      `${alias}.${childParentColumn}`,
      {
        type: options.type,
        rootTenantColumn: options.rootTenantColumn,
        joinedTenantColumn: `${alias}.tenant`,
      }
    );
  }

  function tenantWhereColumn(
    builder: Knex.QueryBuilder,
    leftTenantColumn: string,
    rightTenantColumn: string
  ): Knex.QueryBuilder {
    if (!leftTenantColumn || !leftTenantColumn.trim() || !rightTenantColumn || !rightTenantColumn.trim()) {
      throw new Error('tenantDb.tenantWhereColumn requires tenant columns');
    }

    return builder.whereRaw('?? = ??', [leftTenantColumn, rightTenantColumn]);
  }

  function unscoped<Row extends object = DynamicTenantRow>(
    tableExpression: string,
    reason: string
  ): Knex.QueryBuilder<Row, Row[]> {
    if (!reason || !reason.trim()) {
      throw new Error('tenantDb.unscoped requires a reason');
    }

    return conn<Row, Row[]>(tableExpression);
  }

  return {
    tenant,
    table,
    parentScopedTable,
    insertParentScoped,
    scoped,
    subquery: table,
    tenantJoin,
    tenantJoinSubquery,
    tenantJoinFirstMatching,
    tenantWhereColumn,
    unscoped,
  };
}
