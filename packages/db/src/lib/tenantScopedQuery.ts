import type { Knex } from 'knex';

const tenantScopedQueryBrand: unique symbol = Symbol('TenantScopedQuery');

export interface TenantScopedQuery {
  readonly builder: Knex.QueryBuilder;
  readonly tenant: string;
  readonly rootAlias: string;
  readonly tenantColumn: string;
  readonly qualifiedTenantColumn: string;
  readonly [tenantScopedQueryBrand]: true;
}

export interface TenantScopedQueryOptions {
  table: string;
  alias: string;
  tenant: string;
  tenantColumn?: string;
}

type TenantScopedQueryMetadata = Omit<TenantScopedQuery, 'builder' | typeof tenantScopedQueryBrand>;

function createMetadata(options: TenantScopedQueryOptions): TenantScopedQueryMetadata {
  const tenantColumn = options.tenantColumn ?? 'tenant';
  return {
    tenant: options.tenant,
    rootAlias: options.alias,
    tenantColumn,
    qualifiedTenantColumn: `${options.alias}.${tenantColumn}`,
  };
}

function tagTenantScopedQuery(
  builder: Knex.QueryBuilder,
  metadata: TenantScopedQueryMetadata
): TenantScopedQuery {
  return {
    ...metadata,
    builder,
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
export function createTenantScopedQuery(
  conn: Knex | Knex.Transaction,
  options: TenantScopedQueryOptions
): TenantScopedQuery {
  const metadata = createMetadata(options);
  return tagTenantScopedQuery(
    conn(options.table).where(metadata.qualifiedTenantColumn, options.tenant),
    metadata
  );
}

export function cloneTenantScopedQuery(query: TenantScopedQuery): TenantScopedQuery {
  return tagTenantScopedQuery(query.builder.clone(), query);
}

export function withTenantScopedQueryBuilder(
  query: TenantScopedQuery,
  builder: Knex.QueryBuilder
): TenantScopedQuery {
  return tagTenantScopedQuery(builder, query);
}

export function isTenantScopedQuery(value: unknown): value is TenantScopedQuery {
  return Boolean(
    value &&
      typeof value === 'object' &&
      (value as Partial<TenantScopedQuery>)[tenantScopedQueryBrand] === true
  );
}
