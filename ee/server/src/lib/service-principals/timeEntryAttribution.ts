import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * EE owns the time-entry provenance columns. Every shared write-core update
 * replaces update attribution, including clearing it for a direct human write.
 */
export async function stampTimeEntryAttribution(
  conn: Knex | Knex.Transaction,
  tenant: string,
  entryId: string,
  operation: 'create' | 'update',
  viaPrincipalUserId: string | null | undefined,
): Promise<Record<string, string | null>> {
  const update: Record<string, string | null> = {
    updated_via_principal_id: viaPrincipalUserId ?? null,
  };
  if (operation === 'create') {
    update.created_via_principal_id = viaPrincipalUserId ?? null;
  }

  const [stamped] = await tenantDb(conn, tenant)
    .table('time_entries')
    .where({ entry_id: entryId })
    .update(update)
    .returning(Object.keys(update));
  if (!stamped) {
    throw new Error(`Time entry ${entryId} was not available for attribution stamping`);
  }
  return stamped as Record<string, string | null>;
}
