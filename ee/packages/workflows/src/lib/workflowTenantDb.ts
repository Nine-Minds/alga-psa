import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

type TenantConnection = Knex | Knex.Transaction;

export const WORKFLOW_ALL_TENANT_QUERY_TENANT = '__workflow_all_tenant_query__';
export const WORKFLOW_ALL_TENANT_QUERY_REASON = 'Workflow admin/all-tenant query keeps tenant equality as correlated predicates';

export function workflowTenantDb(
  conn: TenantConnection,
  tenantId: string | null | undefined
): ReturnType<typeof tenantDb> {
  return tenantDb(conn, tenantId ?? WORKFLOW_ALL_TENANT_QUERY_TENANT);
}

export function workflowTenantTable(
  conn: TenantConnection,
  tenantId: string | null | undefined,
  table: string
): Knex.QueryBuilder<any, any>;
export function workflowTenantTable<Row extends object>(
  conn: TenantConnection,
  tenantId: string | null | undefined,
  table: string
): Knex.QueryBuilder<Row, Row[]>;
export function workflowTenantTable(
  conn: TenantConnection,
  tenantId: string | null | undefined,
  table: string
): Knex.QueryBuilder<any, any> {
  const db = workflowTenantDb(conn, tenantId);
  return tenantId
    ? db.table(table)
    : db.unscoped(table, WORKFLOW_ALL_TENANT_QUERY_REASON);
}
