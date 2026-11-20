/**
 * Display resolution for "<human> via <principal>" attribution (PRD R5.8).
 *
 * Edition-neutral: the via-principal columns exist only in the EE schema, so
 * every reader asks `tableHasColumn` before selecting one, and a CE database
 * simply yields no names. Only display names ever leave this module, never ids.
 */
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

const columnCache = new Map<string, Promise<boolean>>();

/** Cached `information_schema` check, so callers can read optional (EE-only) columns safely. */
export function tableHasColumn(knex: Knex | Knex.Transaction, table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`;
  let cached = columnCache.get(key);
  if (!cached) {
    cached = knex.schema.hasColumn(table, column).catch(() => false);
    columnCache.set(key, cached);
  }
  return cached;
}

/** user_id -> display name (first + last, falling back to username) for the given principals. */
export async function resolveViaPrincipalNames(
  knex: Knex | Knex.Transaction,
  tenant: string,
  userIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))));
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const rows = (await tenantDb(knex, tenant)
    .table('users')
    .whereIn('user_id', ids)
    .select('user_id', 'first_name', 'last_name', 'username')) as Array<{
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    username: string | null;
  }>;
  for (const row of rows) {
    const name = [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || row.username || '';
    if (name) names.set(row.user_id, name);
  }
  return names;
}

/**
 * Adds `via_principal_name` to rows whose `viaKey` column is set. Rows with no
 * via value (every row in CE) are returned untouched.
 */
export async function attachViaPrincipalNames<T extends object>(
  knex: Knex | Knex.Transaction,
  tenant: string,
  rows: T[],
  viaKey: string,
): Promise<Array<T & { via_principal_name?: string | null }>> {
  const viaIds = rows.map((row) => (row as Record<string, unknown>)[viaKey] as string | null | undefined);
  if (!viaIds.some(Boolean)) return rows;
  const names = await resolveViaPrincipalNames(knex, tenant, viaIds);
  return rows.map((row, index) => {
    const id = viaIds[index];
    return id ? { ...row, via_principal_name: names.get(id) ?? null } : row;
  });
}
