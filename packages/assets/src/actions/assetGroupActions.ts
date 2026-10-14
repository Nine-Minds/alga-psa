'use server';

import type { Knex } from 'knex';
import type { AssetGroup, AssetGroupKind } from '@alga-psa/types';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { revalidatePath } from 'next/cache';
import {
  addAssetsToGroupRows,
  addGroupUser,
  createGroup,
  deleteGroupRow,
  getGroupWithDetails,
  isAssetGroupError,
  listContactSharedWorkspaces,
  listGroupMemberIds,
  listGroupsForClient,
  removeAssetFromGroupRow,
  removeGroupUser,
  setGroupOwner,
  updateGroupRow,
} from '../lib/assetGroups';
import { resolveAssetTicketContactOptions } from '@alga-psa/shared/models/assetTicketContactModel';
import { publishAssetChanged } from '../lib/assetChangeEvents';
import { tenantDb } from '@alga-psa/db';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

/**
 * FR-E9: group CRUD, membership and people.
 *
 * Groups follow the `asset` resource: reading needs `asset:read`, every
 * mutation `asset:update`. Invariant violations come back as returned action
 * errors so the drawer can show them inline — Next.js masks thrown messages in
 * production builds.
 */

export type AssetGroupActionError = ActionMessageError | ActionPermissionError;

function groupActionError(error: unknown): AssetGroupActionError | null {
  if (isAssetGroupError(error)) {
    return actionError(error.message, `msp/assets:errors.assetGroup.${error.code}`);
  }
  if (error instanceof Error && error.name === 'AssetAssigneeError') {
    return actionError(error.message);
  }
  return null;
}

async function withGroupErrors<T>(work: () => Promise<T>): Promise<T | AssetGroupActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = groupActionError(error);
    if (expected) return expected;
    throw error;
  }
}

function revalidateAssetPaths(): void {
  revalidatePath('/msp/assets');
  revalidatePath('/msp/clients');
}

/**
 * A group write moves its members: the bundle owner assigns them, the location
 * propagates, membership itself changes. Those are the same record fields the
 * edit form publishes ASSET_UPDATED for, so a workflow must hear about them
 * whichever surface did it.
 *
 * The affected assets are snapshotted either side of the transaction — the
 * membership of a group is not the same before and after, and a write that
 * moves five machines has to announce all five.
 */
type AssetSnapshot = Record<string, { contact_name_id: string | null; location_id: string | null; group_id: string | null }>;

async function snapshotAssets(
  conn: Knex,
  tenant: string,
  assetIds: readonly string[]
): Promise<AssetSnapshot> {
  const snapshot: AssetSnapshot = {};
  if (assetIds.length === 0) return snapshot;

  const db = tenantDb(conn, tenant);
  const assets = await (db.table('assets') as Knex.QueryBuilder<any, any>)
    .whereIn('asset_id', assetIds as string[])
    .select('asset_id', 'contact_name_id', 'location_id');
  const memberships = await (db.table('asset_group_members') as Knex.QueryBuilder<any, any>)
    .whereIn('asset_id', assetIds as string[])
    .select('asset_id', 'group_id');
  const groupByAsset = new Map<string, string>(
    (memberships as Array<Record<string, any>>).map((row) => [String(row.asset_id), String(row.group_id)])
  );

  for (const row of assets as Array<Record<string, any>>) {
    snapshot[String(row.asset_id)] = {
      contact_name_id: row.contact_name_id ?? null,
      location_id: row.location_id ?? null,
      group_id: groupByAsset.get(String(row.asset_id)) ?? null,
    };
  }
  return snapshot;
}

const GROUP_CHANGE_PATHS = ['contact_name_id', 'location_id', 'group_id'];

/**
 * Runs a group mutation and publishes ASSET_UPDATED for every member whose
 * record it actually moved.
 */
async function withMemberEvents<T>(
  knex: Knex,
  tenant: string,
  actorUserId: string | null,
  groupId: string,
  extraAssetIds: readonly string[],
  work: () => Promise<T>
): Promise<T> {
  const idsBefore = await listGroupMemberIds(knex, tenant, groupId).catch(() => [] as string[]);
  const watched = Array.from(new Set([...idsBefore, ...extraAssetIds]));
  const before = await snapshotAssets(knex, tenant, watched);

  const result = await work();

  const idsAfter = await listGroupMemberIds(knex, tenant, groupId).catch(() => [] as string[]);
  const all = Array.from(new Set([...watched, ...idsAfter]));
  const after = await snapshotAssets(knex, tenant, all);

  for (const assetId of all) {
    await publishAssetChanged(tenant, [assetId], {
      before: before[assetId] ?? {},
      after: after[assetId] ?? {},
      updatedPaths: GROUP_CHANGE_PATHS,
      actorUserId,
    });
  }

  return result;
}

export const listAssetGroups = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<AssetGroup[] | AssetGroupActionError> => {
  if (!await hasPermission(user, 'asset', 'read')) {
    return permissionError('Permission denied: Cannot read assets', 'msp/assets:errors.permissions.readAssets');
  }
  const { knex } = await createTenantKnex();
  return listGroupsForClient(knex, tenant, clientId);
});

export const getAssetGroup = withAuth(async (
  user,
  { tenant },
  groupId: string
): Promise<AssetGroup | AssetGroupActionError> => {
  if (!await hasPermission(user, 'asset', 'read')) {
    return permissionError('Permission denied: Cannot read assets', 'msp/assets:errors.permissions.readAssets');
  }
  const { knex } = await createTenantKnex();
  return withGroupErrors(() => getGroupWithDetails(knex, tenant, groupId));
});

export const getContactSharedWorkspaces = withAuth(async (
  user,
  { tenant },
  contactId: string
): Promise<AssetGroup[] | AssetGroupActionError> => {
  if (!await hasPermission(user, 'asset', 'read')) {
    return permissionError('Permission denied: Cannot read assets', 'msp/assets:errors.permissions.readAssets');
  }
  const { knex } = await createTenantKnex();
  return listContactSharedWorkspaces(knex, tenant, contactId);
});

export const createAssetGroup = withAuth(async (
  user,
  { tenant },
  input: {
    clientId: string;
    name: string;
    kind: AssetGroupKind;
    locationId?: string | null;
    description?: string | null;
    assetIds?: string[];
  }
): Promise<AssetGroup | AssetGroupActionError> => {
  if (!await hasPermission(user, 'asset', 'update')) {
    return permissionError('Permission denied: Cannot update assets', 'msp/assets:errors.permissions.updateAssets');
  }

  const { knex } = await createTenantKnex();
  return withGroupErrors(async () => {
    const assetIds = input.assetIds ?? [];
    const before = await snapshotAssets(knex, tenant, assetIds);
    const group = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const created = await createGroup(trx, tenant, { ...input, actorUserId: user.user_id });
      if (assetIds.length) {
        await addAssetsToGroupRows(trx, tenant, created.group_id, assetIds, { actorUserId: user.user_id });
      }
      return getGroupWithDetails(trx, tenant, created.group_id);
    });
    const after = await snapshotAssets(knex, tenant, assetIds);
    for (const assetId of assetIds) {
      await publishAssetChanged(tenant, [assetId], {
        before: before[assetId] ?? {},
        after: after[assetId] ?? {},
        updatedPaths: GROUP_CHANGE_PATHS,
        actorUserId: user.user_id,
      });
    }
    revalidateAssetPaths();
    return group;
  });
});

export const updateAssetGroup = withAuth(async (
  user,
  { tenant },
  groupId: string,
  input: { name?: string; kind?: AssetGroupKind; locationId?: string | null; description?: string | null }
): Promise<AssetGroup | AssetGroupActionError> => {
  if (!await hasPermission(user, 'asset', 'update')) {
    return permissionError('Permission denied: Cannot update assets', 'msp/assets:errors.permissions.updateAssets');
  }

  const { knex } = await createTenantKnex();
  return withGroupErrors(async () => {
    const group = await withMemberEvents(knex, tenant, user.user_id, groupId, [], () => withTransaction(knex, async (trx: Knex.Transaction) => {
      await updateGroupRow(trx, tenant, groupId, { ...input, actorUserId: user.user_id });
      return getGroupWithDetails(trx, tenant, groupId);
    }));
    revalidateAssetPaths();
    return group;
  });
});

export const deleteAssetGroup = withAuth(async (
  user,
  { tenant },
  groupId: string
): Promise<{ success: true } | AssetGroupActionError> => {
  if (!await hasPermission(user, 'asset', 'update')) {
    return permissionError('Permission denied: Cannot update assets', 'msp/assets:errors.permissions.updateAssets');
  }

  const { knex } = await createTenantKnex();
  return withGroupErrors(async () => {
    await withMemberEvents(knex, tenant, user.user_id, groupId, [], () =>
      withTransaction(knex, async (trx: Knex.Transaction) =>
        deleteGroupRow(trx, tenant, groupId, { actorUserId: user.user_id })
      )
    );
    revalidateAssetPaths();
    return { success: true as const };
  });
});

export const addAssetsToGroup = withAuth(async (
  user,
  { tenant },
  groupId: string,
  assetIds: string[]
): Promise<AssetGroup | AssetGroupActionError> => {
  if (!await hasPermission(user, 'asset', 'update')) {
    return permissionError('Permission denied: Cannot update assets', 'msp/assets:errors.permissions.updateAssets');
  }

  const { knex } = await createTenantKnex();
  return withGroupErrors(async () => {
    const group = await withMemberEvents(knex, tenant, user.user_id, groupId, assetIds, () => withTransaction(knex, async (trx: Knex.Transaction) => {
      await addAssetsToGroupRows(trx, tenant, groupId, assetIds, { actorUserId: user.user_id });
      return getGroupWithDetails(trx, tenant, groupId);
    }));
    revalidateAssetPaths();
    return group;
  });
});

export const removeAssetFromGroup = withAuth(async (
  user,
  { tenant },
  groupId: string,
  assetId: string
): Promise<AssetGroup | AssetGroupActionError> => {
  if (!await hasPermission(user, 'asset', 'update')) {
    return permissionError('Permission denied: Cannot update assets', 'msp/assets:errors.permissions.updateAssets');
  }

  const { knex } = await createTenantKnex();
  return withGroupErrors(async () => {
    const group = await withMemberEvents(knex, tenant, user.user_id, groupId, [assetId], () => withTransaction(knex, async (trx: Knex.Transaction) => {
      await removeAssetFromGroupRow(trx, tenant, groupId, assetId, { actorUserId: user.user_id });
      return getGroupWithDetails(trx, tenant, groupId);
    }));
    revalidateAssetPaths();
    return group;
  });
});

export const setAssetGroupOwner = withAuth(async (
  user,
  { tenant },
  groupId: string,
  contactId: string | null
): Promise<AssetGroup | AssetGroupActionError> => {
  if (!await hasPermission(user, 'asset', 'update')) {
    return permissionError('Permission denied: Cannot update assets', 'msp/assets:errors.permissions.updateAssets');
  }

  const { knex } = await createTenantKnex();
  return withGroupErrors(async () => {
    const group = await withMemberEvents(knex, tenant, user.user_id, groupId, [], () => withTransaction(knex, async (trx: Knex.Transaction) => {
      await setGroupOwner(trx, tenant, groupId, contactId, { actorUserId: user.user_id });
      return getGroupWithDetails(trx, tenant, groupId);
    }));
    revalidateAssetPaths();
    return group;
  });
});

export const addAssetGroupUser = withAuth(async (
  user,
  { tenant },
  groupId: string,
  contactId: string
): Promise<AssetGroup | AssetGroupActionError> => {
  if (!await hasPermission(user, 'asset', 'update')) {
    return permissionError('Permission denied: Cannot update assets', 'msp/assets:errors.permissions.updateAssets');
  }

  const { knex } = await createTenantKnex();
  return withGroupErrors(async () => {
    const group = await withMemberEvents(knex, tenant, user.user_id, groupId, [], () => withTransaction(knex, async (trx: Knex.Transaction) => {
      await addGroupUser(trx, tenant, groupId, contactId);
      return getGroupWithDetails(trx, tenant, groupId);
    }));
    revalidateAssetPaths();
    return group;
  });
});

export const removeAssetGroupUser = withAuth(async (
  user,
  { tenant },
  groupId: string,
  contactId: string
): Promise<AssetGroup | AssetGroupActionError> => {
  if (!await hasPermission(user, 'asset', 'update')) {
    return permissionError('Permission denied: Cannot update assets', 'msp/assets:errors.permissions.updateAssets');
  }

  const { knex } = await createTenantKnex();
  return withGroupErrors(async () => {
    const group = await withMemberEvents(knex, tenant, user.user_id, groupId, [], () => withTransaction(knex, async (trx: Knex.Transaction) => {
      await removeGroupUser(trx, tenant, groupId, contactId);
      return getGroupWithDetails(trx, tenant, groupId);
    }));
    revalidateAssetPaths();
    return group;
  });
});

/**
 * FR-E8: who a ticket raised from this asset can be filed for.
 *
 * A shared-workspace member has no single assignee, so the group's users are
 * the people who could be reporting the problem. A normal asset offers its
 * assignee. Exactly one option means the caller can preselect it.
 */
export const getAssetTicketContactOptions = withAuth(async (
  user,
  { tenant },
  assetId: string
): Promise<{ options: Array<{ contact_name_id: string; contact_name: string | null }>; preselect: string | null } | AssetGroupActionError> => {
  if (!await hasPermission(user, 'asset', 'read')) {
    return permissionError('Permission denied: Cannot read assets', 'msp/assets:errors.permissions.readAssets');
  }

  const { knex } = await createTenantKnex();
  const options = await resolveAssetTicketContactOptions(knex, tenant, assetId);
  return { options, preselect: options.length === 1 ? options[0].contact_name_id : null };
});
