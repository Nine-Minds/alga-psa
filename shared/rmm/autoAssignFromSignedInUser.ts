import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  getOpenAssetAssignment,
  isMissingAssetGroupTable,
  setAssetAssignee,
} from '../models/assetAssignmentModel';
import {
  isRmmContactAssignmentMode,
  matchContactForRmmUser,
  normalizeRmmUsername,
} from './userMatching';

/**
 * FR-D4: the one auto-assignment step every provider's sync calls.
 *
 * Guard rails, all of them deliberate:
 *   - only in `auto` mode (the default is `suggest`, so nothing moves until an
 *     MSP opts in per organization);
 *   - an empty `current_user` never unassigns — a device nobody is signed into
 *     is not a device nobody owns;
 *   - a shared-workspace member is skipped: its people are the group's users;
 *   - a `manual`, `api`, `bundle` or `import` assignment is never overridden.
 *     Only an unassigned asset, or one whose open assignment came from `rmm`,
 *     is touched.
 */
export async function applyRmmSignedInUserAssignment(
  trx: Knex | Knex.Transaction,
  args: {
    tenant: string;
    assetId: string;
    clientId: string;
    integrationId: string;
    provider: string;
    mode: string | null | undefined;
    currentUser: string | null | undefined;
    actorUserId?: string | null;
  }
): Promise<{ assigned: boolean; contactId?: string; reason?: string }> {
  if (!isRmmContactAssignmentMode(args.mode) || args.mode !== 'auto') {
    return { assigned: false, reason: 'mode' };
  }

  const normalized = normalizeRmmUsername(args.currentUser);
  if (!normalized) {
    // Empty signed-in user: leave whatever is there alone.
    return { assigned: false, reason: 'no_current_user' };
  }

  const db = tenantDb(trx, args.tenant);

  // A shared-workspace member has users, not an assignee (FR-E4). The group
  // tables may not exist yet on an older schema, so a failure here is "not a
  // workspace member" rather than an error.
  try {
    const workspace = await (db.table('asset_group_members as m') as Knex.QueryBuilder<any, any>)
      .join('asset_groups as g', function joinGroups(this: Knex.JoinClause) {
        this.on('g.tenant', '=', 'm.tenant').andOn('g.group_id', '=', 'm.group_id');
      })
      .where({ 'm.asset_id': args.assetId, 'g.kind': 'shared_workspace' })
      .first<{ group_id: string }>('g.group_id');
    if (workspace) return { assigned: false, reason: 'shared_workspace' };
  } catch (error) {
    // Only "the groups tables are not there yet" is absorbed. Any other error
    // inside a transaction would already have aborted it, and swallowing that
    // here could auto-assign a contact onto a shared-workspace member.
    if (!isMissingAssetGroupTable(error)) throw error;
  }

  const open = await getOpenAssetAssignment(trx, args.tenant, args.assetId);
  if (open && open.source !== 'rmm') {
    return { assigned: false, reason: 'manual_assignment' };
  }

  const match = await matchContactForRmmUser(
    trx,
    args.tenant,
    args.clientId,
    args.integrationId,
    args.provider,
    normalized
  );
  if (!match) return { assigned: false, reason: 'no_match' };
  if (open && open.contact_name_id === match.contactId) {
    return { assigned: false, reason: 'unchanged', contactId: match.contactId };
  }

  await setAssetAssignee(trx, args.tenant, args.assetId, match.contactId, {
    actorUserId: args.actorUserId ?? null,
    source: 'rmm',
    provider: args.provider,
    note: String(args.currentUser ?? '').trim() || null,
  });

  return { assigned: true, contactId: match.contactId };
}
