import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { BUILTIN_FETCH_HOSTS } from './fetchHosts';

export const FETCH_HOSTS_TABLE = 'document_fetch_hosts';

/** Pure effective-policy calculation: enabled built-ins plus this tenant's custom hosts. */
export function computeEffectiveFetchHosts(rows: { kind: string; host_pattern: string }[]): string[] {
  const disabledBuiltins = new Set(
    rows.filter((row) => row.kind === 'builtin_disabled').map((row) => row.host_pattern),
  );
  const enabledBuiltins = BUILTIN_FETCH_HOSTS.map(({ pattern }) => pattern).filter(
    (pattern) => !disabledBuiltins.has(pattern),
  );
  const customHosts = rows.filter((row) => row.kind === 'custom').map((row) => row.host_pattern);
  return [...new Set([...enabledBuiltins, ...customHosts])];
}

/** Load the effective download policy for exactly one tenant. Lookup errors propagate. */
export async function loadEffectiveFetchHosts(knex: Knex | Knex.Transaction, tenant: string): Promise<string[]> {
  const rows = await tenantDb(knex, tenant).table(FETCH_HOSTS_TABLE).select('kind', 'host_pattern');
  return computeEffectiveFetchHosts(rows);
}
