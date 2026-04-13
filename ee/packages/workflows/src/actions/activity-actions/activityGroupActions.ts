'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { revalidatePath } from 'next/cache';
import { Knex } from 'knex';

export interface ActivityGroup {
  groupId: string;
  groupName: string;
  sortOrder: number;
  isCollapsed: boolean;
  items: ActivityGroupItem[];
}

export interface ActivityGroupItem {
  itemId: string;
  activityId: string;
  activityType: string;
  sortOrder: number;
}

/**
 * Fetch all groups with their items for the current user.
 * Returns groups sorted by their sort_order, items sorted within each group.
 */
export const getUserActivityGroups = withAuth(async (
  user,
  { tenant }
): Promise<ActivityGroup[]> => {
  const { knex: db } = await createTenantKnex();

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    const groups = await trx('user_activity_groups')
      .where({ tenant, user_id: user.user_id })
      .orderBy('sort_order')
      .select('group_id', 'group_name', 'sort_order', 'is_collapsed');

    if (groups.length === 0) return [];

    const groupIds = groups.map((g) => g.group_id);

    const items = await trx('user_activity_group_items')
      .where({ tenant })
      .whereIn('group_id', groupIds)
      .orderBy('sort_order')
      .select('item_id', 'group_id', 'activity_id', 'activity_type', 'sort_order');

    const itemsByGroup = new Map<string, ActivityGroupItem[]>();
    for (const item of items) {
      const list = itemsByGroup.get(item.group_id) || [];
      list.push({
        itemId: item.item_id,
        activityId: item.activity_id,
        activityType: item.activity_type,
        sortOrder: item.sort_order,
      });
      itemsByGroup.set(item.group_id, list);
    }

    return groups.map((g) => ({
      groupId: g.group_id,
      groupName: g.group_name,
      sortOrder: g.sort_order,
      isCollapsed: g.is_collapsed,
      items: itemsByGroup.get(g.group_id) || [],
    }));
  });
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
  const { knex: db } = await createTenantKnex();

  await withTransaction(db, async (trx: Knex.Transaction) => {
    // Verify target group belongs to user
    const target = await trx('user_activity_groups')
      .where({ tenant, group_id: targetGroupId, user_id: user.user_id })
      .first();
    if (!target) {
      throw new Error('Target group not found');
    }

    // Remove any existing membership of this activity in any of the user's groups
    const userGroups = await trx('user_activity_groups')
      .where({ tenant, user_id: user.user_id })
      .select('group_id');
    const userGroupIds = userGroups.map((g) => g.group_id);

    if (userGroupIds.length > 0) {
      await trx('user_activity_group_items')
        .where({ tenant, activity_id: activityId, activity_type: activityType })
        .whereIn('group_id', userGroupIds)
        .del();
    }

    // Insert at new position
    await trx('user_activity_group_items').insert({
      tenant,
      group_id: targetGroupId,
      activity_id: activityId,
      activity_type: activityType,
      sort_order: sortOrder,
    });
  });

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
  const { knex: db } = await createTenantKnex();

  await withTransaction(db, async (trx: Knex.Transaction) => {
    const userGroups = await trx('user_activity_groups')
      .where({ tenant, user_id: user.user_id })
      .select('group_id');
    const userGroupIds = userGroups.map((g) => g.group_id);

    if (userGroupIds.length === 0) return;

    await trx('user_activity_group_items')
      .where({ tenant, activity_id: activityId, activity_type: activityType })
      .whereIn('group_id', userGroupIds)
      .del();
  });

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
  const { knex: db } = await createTenantKnex();

  await withTransaction(db, async (trx: Knex.Transaction) => {
    // Verify group ownership
    const group = await trx('user_activity_groups')
      .where({ tenant, group_id: groupId, user_id: user.user_id })
      .first();
    if (!group) {
      throw new Error('Group not found');
    }

    for (const item of orderedItems) {
      await trx('user_activity_group_items')
        .where({
          tenant,
          group_id: groupId,
          activity_id: item.activityId,
          activity_type: item.activityType,
        })
        .update({ sort_order: item.sortOrder });
    }
  });

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
