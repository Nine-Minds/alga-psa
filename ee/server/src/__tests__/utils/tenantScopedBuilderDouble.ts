/**
 * Makes a hand-rolled knex query-builder double survive the tenantDb facade.
 *
 * `tenantDb(conn, tenant).table(x)` hands back `conn(x).where('x.tenant',
 * tenant)` — the scoping is applied before the caller sees the builder. Doubles
 * written against the pre-facade code return objects with no `where` at all and
 * fail with "conn(...).where is not a function"; doubles that do record `where`
 * suddenly see an extra call they never asserted.
 *
 * Wrapping a builder here swallows exactly the facade's scoping call and passes
 * every other `where` through, so a test asserts on its query's own filters and
 * nothing else.
 */
export interface TenantScopedDouble {
  /**
   * The tenant the facade scoped this builder to. Doubles that key stored rows
   * by tenant can read it instead of expecting a `tenant` column in the
   * query's own where clause, which the facade now supplies separately.
   */
  scopedTenant: string | null;
}

export function withTenantScope<T extends Record<string, any>>(
  builder: T
): T & TenantScopedDouble {
  const scoped = builder as T & TenantScopedDouble & { where?: (...args: unknown[]) => unknown };
  const underlyingWhere = scoped.where;
  scoped.scopedTenant = null;

  scoped.where = (...args: unknown[]) => {
    const [column, value] = args;
    if (args.length === 2 && typeof column === 'string' && column.endsWith('.tenant')) {
      scoped.scopedTenant = typeof value === 'string' ? value : null;
      return scoped;
    }

    return underlyingWhere ? underlyingWhere.apply(scoped, args) : scoped;
  };

  return scoped;
}
