import type { Knex } from 'knex';
import { parseTableExpression } from './tenantTableMetadata';

const tenantScopedQueryBrand: unique symbol = Symbol('TenantScopedQuery');

export interface TenantScopedQuery {
  readonly builder: Knex.QueryBuilder;
  readonly tenant: string;
  readonly rootAlias: string;
  readonly tenantColumn: string;
  readonly qualifiedTenantColumn: string;
  clone(): TenantScopedQuery;
  withBuilder(builder: Knex.QueryBuilder): TenantScopedQuery;
  readonly [tenantScopedQueryBrand]: true;
}

export interface TenantScopedRootQueryOptions {
  table: string;
  alias?: string;
  tenant: string;
  tenantColumn?: string;
}

type TenantScopedQueryMetadata = Pick<
  TenantScopedQuery,
  'tenant' | 'rootAlias' | 'tenantColumn' | 'qualifiedTenantColumn'
>;

function createMetadata(options: TenantScopedRootQueryOptions): TenantScopedQueryMetadata {
  const tenantColumn = options.tenantColumn ?? 'tenant';
  const rootAlias = options.alias ?? parseTableExpression(options.table).rootAlias;
  return {
    tenant: options.tenant,
    rootAlias,
    tenantColumn,
    qualifiedTenantColumn: `${rootAlias}.${tenantColumn}`,
  };
}

function tagTenantScopedQuery(
  builder: Knex.QueryBuilder,
  metadata: TenantScopedQueryMetadata
): TenantScopedQuery {
  return {
    ...metadata,
    builder,
    clone: () => tagTenantScopedQuery(builder.clone(), metadata),
    withBuilder: (nextBuilder: Knex.QueryBuilder) => tagTenantScopedQuery(nextBuilder, metadata),
    [tenantScopedQueryBrand]: true,
  };
}

/**
 * Create a query whose root table is structurally scoped to one tenant.
 *
 * This wrapper exists for safety-sensitive query builders, such as SQL
 * authorization narrowing. It makes the root tenant predicate part of the type
 * contract instead of an unverified call-site convention.
 */
export function createTenantScopedRootQuery(
  conn: Knex | Knex.Transaction,
  options: TenantScopedRootQueryOptions
): TenantScopedQuery {
  const metadata = createMetadata(options);
  return tagTenantScopedQuery(
    conn(options.table).where(metadata.qualifiedTenantColumn, options.tenant),
    metadata
  );
}

export function isTenantScopedQuery(value: unknown): value is TenantScopedQuery {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as Partial<TenantScopedQuery>)[tenantScopedQueryBrand] === true
  );
}
