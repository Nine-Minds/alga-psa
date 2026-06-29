'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { revalidatePath } from 'next/cache';
import { Knex } from 'knex';
import {
  getUserActivityGroupsForApi,
  moveActivityToGroupForApi,
  removeActivityFromGroupsForApi,
  reorderActivitiesInGroupForApi,
} from './activityGroupCore';
import type { ActivityGroup, ActivityGroupItem } from './activityGroupCore';

// Re-export via the `from` form (not a bare `export type { … }` of the imported binding):
// turbopack mis-emits the bare re-export as a runtime value export, throwing
// "ActivityGroup is not defined" when the actions module evaluates.
export type { ActivityGroup, ActivityGroupItem } from './activityGroupCore';

/**
 * Fetch all groups with their items for a user.
 * Defaults to the caller's own groups. When `targetUserId` names another internal
 * user, return that user's groups instead — gated by the same permission used to view
 * another user's activities (user_schedule:update or user_schedule:read_all), so the
 * grouped view reflects the user currently being viewed.
 * Returns groups sorted by their sort_order, items sorted within each group.
 */
export const getUserActivityGroups = withAuth(async (
  user,
  { tenant },
  targetUserId?: string
): Promise<ActivityGroup[]> => {
  return getUserActivityGroupsForApi(user, tenant, targetUserId);
});

/**
 * Create a new activity group for the current user.
 */
export const createActivityGroup = withAuth(async (
  user,
  { tenant },
  groupName: string
): Promise<ActivityGroup> => {
  if (!groupName || !groupName.trim()) {
    throw new Error('Group name cannot be empty');
  }

  const { knex: db } = await createTenantKnex();

  const group = await withTransaction(db, async (trx: Knex.Transaction) => {
    // Next sort order = max + 1
    const maxSort = await trx('user_activity_groups')
      .where({ tenant, user_id: user.user_id })
      .max('sort_order as max')
      .first();

    const nextSortOrder = ((maxSort?.max as number | null) ?? -1) + 1;

    const [created] = await trx('user_activity_groups')
      .insert({
        tenant,
        user_id: user.user_id,
        group_name: groupName.trim(),
        sort_order: nextSortOrder,
        is_collapsed: false,
      })
      .returning(['group_id', 'group_name', 'sort_order', 'is_collapsed']);

    return created;
  });

  revalidatePath('/activities');

  return {
    groupId: group.group_id,
    groupName: group.group_name,
    sortOrder: group.sort_order,
    isCollapsed: group.is_collapsed,
    items: [],
  };
});

/**
 * Update a group's name or collapse state.
 */
export const updateActivityGroup = withAuth(async (
  user,
  { tenant },
  groupId: string,
  updates: { groupName?: string; isCollapsed?: boolean }
): Promise<boolean> => {
  const { knex: db } = await createTenantKnex();

  await withTransaction(db, async (trx: Knex.Transaction) => {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (updates.groupName !== undefined) {
      if (!updates.groupName.trim()) {
        throw new Error('Group name cannot be empty');
      }
      patch.group_name = updates.groupName.trim();
    }
    if (updates.isCollapsed !== undefined) {
      patch.is_collapsed = updates.isCollapsed;
    }

    await trx('user_activity_groups')
      .where({ tenant, group_id: groupId, user_id: user.user_id })
      .update(patch);
  });

  revalidatePath('/activities');
  return true;
});

/**
 * Delete a group. Items in the group are deleted (activities become ungrouped).
 */
export const deleteActivityGroup = withAuth(async (
  user,
  { tenant },
  groupId: string
): Promise<boolean> => {
  const { knex: db } = await createTenantKnex();

  await withTransaction(db, async (trx: Knex.Transaction) => {
    // Verify ownership first
    const group = await trx('user_activity_groups')
      .where({ tenant, group_id: groupId, user_id: user.user_id })
      .first();
    if (!group) {
      throw new Error('Group not found');
    }

    await trx('user_activity_group_items').where({ tenant, group_id: groupId }).del();
    await trx('user_activity_groups').where({ tenant, group_id: groupId }).del();
  });

  revalidatePath('/activities');
  return true;
});

/**
 * Move an activity to a different group (or into a group for the first time).
 * The activity is placed at the specified sort order. If the activity was
 * already in another group, it's removed from there.
 */
export const moveActivityToGroup = withAuth(async (
  user,
  { tenant },
  activityId: string,
  activityType: string,
  targetGroupId: string,
  sortOrder: number
): Promise<boolean> => {
  await moveActivityToGroupForApi(user, tenant, activityId, activityType, targetGroupId, sortOrder);
  revalidatePath('/activities');
  return true;
});

/**
 * Remove an activity from any group (makes it "ungrouped").
 */
export const removeActivityFromGroups = withAuth(async (
  user,
  { tenant },
  activityId: string,
  activityType: string
): Promise<boolean> => {
  await removeActivityFromGroupsForApi(user, tenant, activityId, activityType);
  revalidatePath('/activities');
  return true;
});

/**
 * Batch update sort orders of items within a group (after drag-to-reorder).
 * Pass the full ordered list of items as they should appear.
 */
export const reorderActivitiesInGroup = withAuth(async (
  user,
  { tenant },
  groupId: string,
  orderedItems: Array<{ activityId: string; activityType: string; sortOrder: number }>
): Promise<boolean> => {
  await reorderActivitiesInGroupForApi(user, tenant, groupId, orderedItems);
  revalidatePath('/activities');
  return true;
});

/**
 * Batch update sort orders of groups (after drag-to-reorder groups).
 */
export const reorderGroups = withAuth(async (
  user,
  { tenant },
  orderedGroups: Array<{ groupId: string; sortOrder: number }>
): Promise<boolean> => {
  const { knex: db } = await createTenantKnex();

  await withTransaction(db, async (trx: Knex.Transaction) => {
    for (const g of orderedGroups) {
      await trx('user_activity_groups')
        .where({ tenant, group_id: g.groupId, user_id: user.user_id })
        .update({ sort_order: g.sortOrder, updated_at: new Date() });
    }
  });

  revalidatePath('/activities');
  return true;
});
