import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IClient } from '@alga-psa/types';

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string,
): Knex.QueryBuilder<any, any> {
  return tenantDb(conn, tenant).table(table) as Knex.QueryBuilder<any, any>;
}

/**
 * clients.client_since is a DATE and the driver builds it at the server's
 * midnight. These rows reach the client drawer, which edits that date, so send
 * the calendar date as 'yyyy-MM-dd' rather than a Date the browser would read a
 * day early.
 */
function clientSinceDateString<T extends Record<string, any>>(row: T): T {
  const value = row.client_since;
  if (!(value instanceof Date)) return row;
  const pad = (part: number) => String(part).padStart(2, '0');
  return { ...row, client_since: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` };
}

export async function getClientById(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<IClient | null> {
  const client = await tenantScopedTable(knexOrTrx, tenant, 'clients')
    .where({ client_id: clientId })
    .first();

  if (!client) return null;
  return clientSinceDateString({ ...client, properties: (client as any).properties ?? {} }) as IClient;
}

export async function getAllClients(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  includeInactive: boolean = true
): Promise<IClient[]> {
  const query = tenantScopedTable(knexOrTrx, tenant, 'clients')
    .orderBy('client_name', 'asc')
    .select('*');

  if (!includeInactive) {
    query.andWhere({ is_inactive: false });
  }

  const rows = await query as Array<Record<string, any>>;
  return rows.map((c) => clientSinceDateString({ ...c, properties: (c as any).properties ?? {} }) as IClient);
}
