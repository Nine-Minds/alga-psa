import { tenantDb, type TenantJoinOptions } from '@alga-psa/db';
import type { Knex } from 'knex';

export function createTenantScopedIndexerQuery<Row extends object>(
  knex: Knex,
  table: string,
  alias: string,
  tenant: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(knex, tenant).table<Row>(alias ? `${table} as ${alias}` : table);
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
