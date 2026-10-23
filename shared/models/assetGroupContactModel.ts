import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isMissingAssetGroupTable, setAssetAssignee } from './assetAssignmentModel';

/**
 * FR-E6: contact deletion cleanup for asset groups.
 *
 * Lives in `shared/` for the same reason as the assignment helper: the contact
 * model that calls it is in `shared/`, and `packages/assets` already depends on
 * `@alga-psa/shared`, so the reverse import would close a cycle. The group
 * model (packages/assets/src/lib/assetGroups.ts) re-exports it.
 *
 * A deleted contact stops being a workspace user. A deleted bundle owner leaves
 * its members unassigned, through the assignment helper so the history records
 * the clear rather than a row quietly vanishing.
 */
export async function clearGroupContactLinksForContact(
  conn: Knex | Knex.Transaction,
  tenant: string,
  contactId: string,
  options?: { actorUserId?: string | null }
): Promise<void> {
  const db = tenantDb(conn, tenant);

  let ownedGroupIds: string[] = [];
  try {
    ownedGroupIds = await (db.table('asset_group_contacts') as Knex.QueryBuilder<any, any>)
      .where({ contact_name_id: contactId, role: 'owner' })
      .pluck('group_id');
  } catch (error) {
    // Before the group migration there is nothing to clean up; any other
    // error must reach the contact-deletion caller.
    if (!isMissingAssetGroupTable(error)) throw error;
    return;
  }

  for (const groupId of ownedGroupIds) {
    const memberIds: string[] = await (db.table('asset_group_members') as Knex.QueryBuilder<any, any>)
      .where({ group_id: groupId })
      .pluck('asset_id');
    for (const assetId of memberIds) {
      await setAssetAssignee(conn, tenant, assetId, null, {
        actorUserId: options?.actorUserId ?? null,
        source: 'system',
        note: 'Bundle owner deleted',
        allowWorkspaceMember: true,
      });
    }
  }

  await (db.table('asset_group_contacts') as Knex.QueryBuilder<any, any>)
    .where({ contact_name_id: contactId })
    .delete();
}
