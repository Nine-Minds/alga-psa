import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export interface AssetTicketContactOption {
  contact_name_id: string;
  contact_name: string | null;
}

/**
 * FR-E8: the contacts a ticket raised from an asset can be filed for.
 *
 * A shared-workspace member has no single assignee — its users are the people
 * who could be reporting the problem — so the workspace's users are offered
 * instead. A normal asset offers its assignee, or nothing when it is
 * unassigned.
 *
 * In `shared/` because the alert ticket creator (workflow worker) needs it as
 * well as the MSP, portal and mobile ticket-from-asset surfaces.
 */
export async function resolveAssetTicketContactOptions(
  conn: Knex | Knex.Transaction,
  tenant: string,
  assetId: string
): Promise<AssetTicketContactOption[]> {
  const db = tenantDb(conn, tenant);

  try {
    const workspaceUsers = await (db.table('asset_group_members as m') as Knex.QueryBuilder<any, any>)
      .join('asset_groups as g', function joinGroups(this: Knex.JoinClause) {
        this.on('g.tenant', '=', 'm.tenant').andOn('g.group_id', '=', 'm.group_id');
      })
      .join('asset_group_contacts as gc', function joinContacts(this: Knex.JoinClause) {
        this.on('gc.tenant', '=', 'g.tenant').andOn('gc.group_id', '=', 'g.group_id');
      })
      .leftJoin('contacts', function joinContactNames(this: Knex.JoinClause) {
        this.on('contacts.tenant', '=', 'gc.tenant').andOn('contacts.contact_name_id', '=', 'gc.contact_name_id');
      })
      .where({ 'm.asset_id': assetId, 'g.kind': 'shared_workspace', 'gc.role': 'user' })
      .select<AssetTicketContactOption[]>('gc.contact_name_id as contact_name_id', 'contacts.full_name as contact_name')
      .orderBy('contacts.full_name', 'asc');

    if (workspaceUsers.length > 0) return workspaceUsers;
  } catch {
    // The group tables arrive in a later migration; fall through to the assignee.
  }

  const asset = await (db.table('assets') as Knex.QueryBuilder<any, any>)
    .where({ asset_id: assetId })
    .first<{ contact_name_id?: string | null }>('contact_name_id');
  if (!asset?.contact_name_id) return [];

  const contact = await (db.table('contacts') as Knex.QueryBuilder<any, any>)
    .where({ contact_name_id: asset.contact_name_id })
    .first<{ full_name?: string | null }>('full_name');

  return [{ contact_name_id: asset.contact_name_id, contact_name: contact?.full_name ?? null }];
}
