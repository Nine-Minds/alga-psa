import { tenantDb, type TenantJoinOptions } from '@alga-psa/db';
import type { Knex } from 'knex';

export function createTenantScopedIndexerQuery<Row extends object>(
  knex: Knex,
  table: string,
  alias: string,
  tenant: string
): Knex.QueryBuilder<Row, Row[]> {
  // Callers pass either a bare table or an already-aliased expression
  // ('tickets as t'); re-appending the alias would double it and the
  // expression would no longer resolve in the tenant table registry.
  const expression = /\s+as\s+/i.test(table) ? table : alias ? `${table} as ${alias}` : table;
  return tenantDb(knex, tenant).table<Row>(expression);
}

export function tenantJoinIndexerTable(
  knex: Knex,
  tenant: string,
  builder: Knex.QueryBuilder,
  tableExpression: string,
  left: string,
  right: string,
  options?: TenantJoinOptions
): Knex.QueryBuilder {
  return tenantDb(knex, tenant).tenantJoin(builder, tableExpression, left, right, options);
}
