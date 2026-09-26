import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export async function associateAssetWithTicket(
  trx: Knex.Transaction,
  tenantId: string,
  assetId: string,
  ticketId: string,
  now: string
): Promise<void> {
  const db = tenantDb(trx, tenantId);
  // created_by is required. Use the tenant's earliest user for system-created links.
  const auditUser = await db.table('users').orderBy('created_at', 'asc').first('user_id');
  if (!auditUser) return;
  try {
    await db.table('asset_associations').insert({
      tenant: tenantId,
      asset_id: assetId,
      entity_id: ticketId,
      entity_type: 'ticket',
      relationship_type: 'related',
      created_by: auditUser.user_id,
      created_at: now,
    });
  } catch (error: any) {
    if (error?.code === '23505') return;
    throw error;
  }
}
