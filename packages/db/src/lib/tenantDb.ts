import type { Knex } from 'knex';
import {
  parseTableExpression,
  requireTenantTableScope,
  type ParsedTableExpression,
  type TenantTableScope,
} from './tenantTableMetadata';
import { createTenantScopedRootQuery, type TenantScopedQuery } from './tenantScopedQuery';

export interface TenantJoinOptions {
  type?: 'inner' | 'left';
  rootTenantColumn?: string;
  on?: (join: Knex.JoinClause) => void;
}

type DynamicTenantRow = Record<string, any>;

export interface TenantDb {
  readonly tenant: string;
  table<Row extends object = DynamicTenantRow>(tableExpression: string): Knex.QueryBuilder<Row, Row[]>;
  scoped(tableExpression: string): TenantScopedQuery;
  subquery<Row extends object = DynamicTenantRow>(tableExpression: string): Knex.QueryBuilder<Row, Row[]>;
  tenantJoin(
    builder: Knex.QueryBuilder,
    tableExpression: string,
    left: string,
    right: string,
    options?: TenantJoinOptions
  ): Knex.QueryBuilder;
  unscoped<Row extends object = DynamicTenantRow>(
    tableExpression: string,
    reason: string
  ): Knex.QueryBuilder<Row, Row[]>;
}

function assertTenant(tenant: string): void {
  if (!tenant || !tenant.trim()) {
    throw new Error('tenantDb requires a tenant id');
  }
}

function tenantColumn(scope: TenantTableScope): string {
  return scope.scope === 'tenant' ? scope.tenantColumn ?? 'tenant' : 'tenant';
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

export function tenantDb(conn: Knex | Knex.Transaction, tenant: string): TenantDb {
  assertTenant(tenant);

  function scoped(tableExpression: string): TenantScopedQuery {
    const parsed = parseTableExpression(tableExpression);
    const scope = requireTenantTableScope(parsed.tableName);

    if (scope.scope === 'global') {
      throw new Error(`Global table ${parsed.tableName} cannot create a tenant-scoped query`);
    }

    if (scope.scope === 'admin') {
      throw new Error(`Admin table ${parsed.tableName} cannot be accessed through tenantDb.scoped`);
    }

    return createTenantScopedRootQuery(conn, {
      table: tableExpression,
      alias: parsed.rootAlias,
      tenant,
      tenantColumn: tenantColumn(scope),
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

    return scoped(tableExpression).builder as Knex.QueryBuilder<Row, Row[]>;
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
        this.andOn(
          `${parsed.rootAlias}.${tenantColumn(scope)}`,
          '=',
          options.rootTenantColumn ?? inferRootTenantColumn(parsed, left, right)
        );
      }

      options.on?.(this);
    };

    if (options.type === 'left') {
      return builder.leftJoin(tableExpression, joinTenantTable);
    }

    return builder.join(tableExpression, joinTenantTable);
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
    scoped,
    subquery: table,
    tenantJoin,
    unscoped,
  };
}
