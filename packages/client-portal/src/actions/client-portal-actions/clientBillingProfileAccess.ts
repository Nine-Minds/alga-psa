import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';

/**
 * Which billing profiles a portal user may see (F123–F125, F127).
 *
 * `null` means unrestricted — the user sees every profile their client has.
 * That is the default and it is expressed by the *absence* of rows, so a
 * profile added later is visible to unrestricted users automatically rather
 * than silently disappearing until someone grants it.
 *
 * The restriction is applied here, inside the queries, rather than in the
 * portal UI: a client that only filters in the browser is not filtered. Every
 * portal segment query narrows through `restrictToPermittedProfiles` before it
 * returns anything, and organisation-wide totals are summed from the narrowed
 * set, so a restricted user's "whole organisation" figure is the whole of what
 * they are allowed to see (F125) rather than a number they cannot reconcile.
 */

export const PORTAL_PROFILE_ACCESS_TABLE = 'client_portal_user_billing_profiles';

export async function getPermittedBillingProfileIds(
  connection: Knex | Knex.Transaction,
  tenant: string,
  user: IUserWithRoles,
  clientId: string,
): Promise<Set<string> | null> {
  const db = tenantDb(connection, tenant);
  const query = db.table(`${PORTAL_PROFILE_ACCESS_TABLE} as access`);
  db.tenantJoin(
    query,
    'client_billing_profiles as p',
    'p.billing_profile_id',
    'access.billing_profile_id',
  );
  const rows = await query
    .where('access.user_id', user.user_id)
    // A grant only counts within the user's own client. A stale grant to a
    // profile of some other client must not widen what they see.
    .where('p.client_id', clientId)
    .select('access.billing_profile_id');

  if (rows.length === 0) return null;
  return new Set(rows.map((row: any) => row.billing_profile_id as string));
}

export function restrictToPermittedProfiles<T extends { billing_profile_id: string }>(
  profiles: T[],
  permitted: Set<string> | null,
): T[] {
  if (!permitted) return profiles;
  return profiles.filter((profile) => permitted.has(profile.billing_profile_id));
}
