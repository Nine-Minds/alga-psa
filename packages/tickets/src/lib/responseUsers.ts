import {
  USER_RESPONSE_FIELD_NAMES,
  sanitizeUserForResponse,
  type SafeApiUser,
} from '@alga-psa/types';

/**
 * The one way ticket loaders read `users` rows that will be returned to the client:
 *
 *   sanitizeResponseUsers(await projectResponseUsers(tenantScopedTable(trx, 'users', tenant)).where(...))
 *
 * `projectResponseUsers` restricts the SELECT to the shared allow-list (credential columns are never
 * fetched); `sanitizeResponseUser(s)` is the belt-and-braces strip on the way out. Callers keep their
 * own filtering/ordering/`.first()`.
 */
export function projectResponseUsers<Q extends { select(columns: string[]): Q }>(query: Q): Q {
  return query.select(USER_RESPONSE_FIELD_NAMES);
}

export function sanitizeResponseUsers(rows: Array<Record<string, unknown>>): SafeApiUser[] {
  return rows.map((row) => sanitizeUserForResponse(row));
}

export function sanitizeResponseUser(row: Record<string, unknown> | null | undefined): SafeApiUser | null {
  return row ? sanitizeUserForResponse(row) : null;
}
