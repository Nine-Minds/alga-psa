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
  getAssetGroupRow,
  getGroupWithDetails,
  isAssetGroupError,
  listContactSharedWorkspaces,
  listGroupsForClient,
  removeAssetFromGroupRow,
  removeGroupUser,
  setGroupOwner,
  updateGroupRow,
} from '../lib/assetGroups';
import { resolveAssetTicketContactOptions } from '@alga-psa/shared/models/assetTicketContactModel';
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

export const getAssetGroupForAsset = withAuth(async (
  user,
  { tenant },
  assetId: string
): Promise<AssetGroup | null | AssetGroupActionError> => {
  if (!await hasPermission(user, 'asset', 'read')) {
    return permissionError('Permission denied: Cannot read assets', 'msp/assets:errors.permissions.readAssets');
  }
  const { knex } = await createTenantKnex();
  const group = await getAssetGroupRow(knex, tenant, assetId);
  if (!group) return null;
  return getGroupWithDetails(knex, tenant, group.group_id);
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
    const group = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const created = await createGroup(trx, tenant, { ...input, actorUserId: user.user_id });
      if (input.assetIds?.length) {
        await addAssetsToGroupRows(trx, tenant, created.group_id, input.assetIds, { actorUserId: user.user_id });
      }
      return getGroupWithDetails(trx, tenant, created.group_id);
    });
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
    const group = await withTransaction(knex, async (trx: Knex.Transaction) => {
      await updateGroupRow(trx, tenant, groupId, { ...input, actorUserId: user.user_id });
      return getGroupWithDetails(trx, tenant, groupId);
    });
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
    await withTransaction(knex, async (trx: Knex.Transaction) =>
      deleteGroupRow(trx, tenant, groupId, { actorUserId: user.user_id })
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
    const group = await withTransaction(knex, async (trx: Knex.Transaction) => {
      await addAssetsToGroupRows(trx, tenant, groupId, assetIds, { actorUserId: user.user_id });
      return getGroupWithDetails(trx, tenant, groupId);
    });
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
    const group = await withTransaction(knex, async (trx: Knex.Transaction) => {
      await removeAssetFromGroupRow(trx, tenant, groupId, assetId, { actorUserId: user.user_id });
      return getGroupWithDetails(trx, tenant, groupId);
    });
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
    const group = await withTransaction(knex, async (trx: Knex.Transaction) => {
      await setGroupOwner(trx, tenant, groupId, contactId, { actorUserId: user.user_id });
      return getGroupWithDetails(trx, tenant, groupId);
    });
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
    const group = await withTransaction(knex, async (trx: Knex.Transaction) => {
      await addGroupUser(trx, tenant, groupId, contactId);
      return getGroupWithDetails(trx, tenant, groupId);
    });
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
    const group = await withTransaction(knex, async (trx: Knex.Transaction) => {
      await removeGroupUser(trx, tenant, groupId, contactId);
      return getGroupWithDetails(trx, tenant, groupId);
    });
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
