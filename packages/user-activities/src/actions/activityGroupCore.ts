/**
 * Activity-group core logic.
 *
 * Plain functions that take an explicit `(user, tenant, …)` identity. Shared by the web app
 * (via the `withAuth` exports in `activityGroupActions.ts`) and the v1 REST API (which
 * resolves the user from an API key and calls these directly under `runWithTenant`).
 *
 * IMPORTANT: no `'use server'` directive — these are unauthenticated by design (the caller
 * supplies the resolved identity), so they must never be registered as client-callable
 * server actions. They import knex, so this module must stay out of any client bundle (it
 * is exposed only through `@alga-psa/user-activities/server/activity-actions`).
 */

import { createTenantKnex, withTransaction } from "@alga-psa/db";
import { hasPermission } from "@alga-psa/auth";
import type { IUserWithRoles } from "@alga-psa/types";
import type { Knex } from "knex";

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
 * Fetch all custom groups (with their ordered items) for a user. Defaults to the caller's
 * own groups; when `targetUserId` names another internal user, returns that user's groups
 * — gated by the same capability used to view another user's activities
 * (user_schedule:update or user_schedule:read_all). Read-only: callers (web grouped view,
 * mobile "My groups") render these; mutations live in the `withAuth` group actions.
 */
export async function getUserActivityGroupsForApi(
  user: IUserWithRoles,
  tenant: string,
  targetUserId?: string,
): Promise<ActivityGroup[]> {
  const { knex: db } = await createTenantKnex(tenant);

  return await withTransaction(db, async (trx: Knex.Transaction) => {
    let ownerUserId = user.user_id;
    if (targetUserId && targetUserId !== user.user_id) {
      const [canUpdate, canReadAll] = await Promise.all([
        hasPermission(user, "user_schedule", "update", trx),
        hasPermission(user, "user_schedule", "read_all", trx),
      ]);
      if (!canUpdate && !canReadAll) {
        throw new Error("Permission denied: cannot view another user's groups");
      }
      const target = await trx("users")
        .where({ tenant, user_id: targetUserId, user_type: "internal" })
        .first();
      if (!target) {
        throw new Error("User not found");
      }
      ownerUserId = targetUserId;
    }

    const groups = await trx("user_activity_groups")
      .where({ tenant, user_id: ownerUserId })
      .orderBy("sort_order")
      .select("group_id", "group_name", "sort_order", "is_collapsed");

    if (groups.length === 0) return [];

    const groupIds = groups.map((g) => g.group_id);

    const items = await trx("user_activity_group_items")
      .where({ tenant })
      .whereIn("group_id", groupIds)
      .orderBy("sort_order")
      .select("item_id", "group_id", "activity_id", "activity_type", "sort_order");

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
}

/**
 * Gate group-organization writes. Custom activity groups are always the caller's own (the
 * mutations below scope every query by `user_id`, so a user can only ever touch their own
 * groups). On top of that ownership scoping we require `user_schedule:read` — the same
 * baseline capability needed to see and create one's own activities — as defense in depth.
 */
async function assertCanOrganizeGroups(
  trx: Knex.Transaction,
  user: IUserWithRoles,
): Promise<void> {
  if (!(await hasPermission(user, "user_schedule", "read", trx))) {
    throw new Error("Permission denied: cannot organize activity groups");
  }
}

/**
 * Move an activity into a group at a specific position. If it already belonged to one of the
 * caller's groups it's removed from there first, so an activity lives in at most one group.
 * Rows at/after the insertion index are shifted up to keep `sort_order` dense and unique.
 *
 * Identity-explicit core shared by the web `withAuth` action and the v1 REST API; scoped to
 * the caller's own groups by `user_id`.
 */
export async function moveActivityToGroupForApi(
  user: IUserWithRoles,
  tenant: string,
  activityId: string,
  activityType: string,
  targetGroupId: string,
  sortOrder: number,
): Promise<void> {
  if (!activityId || !activityType) {
    throw new Error("Activity id and type are required");
  }
  if (!targetGroupId) {
    throw new Error("Target group id is required");
  }

  const { knex: db } = await createTenantKnex(tenant);
  await withTransaction(db, async (trx: Knex.Transaction) => {
    await assertCanOrganizeGroups(trx, user);

    const target = await trx("user_activity_groups")
      .where({ tenant, group_id: targetGroupId, user_id: user.user_id })
      .first();
    if (!target) {
      throw new Error("Target group not found");
    }

    // Remove any existing membership of this activity in any of the caller's groups.
    const userGroupIds = await trx("user_activity_groups")
      .where({ tenant, user_id: user.user_id })
      .pluck("group_id");

    if (userGroupIds.length > 0) {
      await trx("user_activity_group_items")
        .where({ tenant, activity_id: activityId, activity_type: activityType })
        .whereIn("group_id", userGroupIds)
        .del();
    }

    // Make room at the insertion index so rows never share a sort_order (which would make
    // the order non-deterministic on reload).
    await trx("user_activity_group_items")
      .where({ tenant, group_id: targetGroupId })
      .andWhere("sort_order", ">=", sortOrder)
      .increment("sort_order", 1);

    await trx("user_activity_group_items").insert({
      tenant,
      group_id: targetGroupId,
      activity_id: activityId,
      activity_type: activityType,
      sort_order: sortOrder,
    });
  });
}

/**
 * Remove an activity from any of the caller's groups (makes it "ungrouped"). No-op when the
 * caller has no groups. Identity-explicit core scoped to the caller's own groups.
 */
export async function removeActivityFromGroupsForApi(
  user: IUserWithRoles,
  tenant: string,
  activityId: string,
  activityType: string,
): Promise<void> {
  if (!activityId || !activityType) {
    throw new Error("Activity id and type are required");
  }

  const { knex: db } = await createTenantKnex(tenant);
  await withTransaction(db, async (trx: Knex.Transaction) => {
    await assertCanOrganizeGroups(trx, user);

    const userGroupIds = await trx("user_activity_groups")
      .where({ tenant, user_id: user.user_id })
      .pluck("group_id");
    if (userGroupIds.length === 0) return;

    await trx("user_activity_group_items")
      .where({ tenant, activity_id: activityId, activity_type: activityType })
      .whereIn("group_id", userGroupIds)
      .del();
  });
}

/**
 * Persist the full ordered membership of a single group after a drag-to-reorder. Pass every
 * item as it should appear; each row's `sort_order` is set to its position. Identity-explicit
 * core scoped to the caller's own groups.
 */
export async function reorderActivitiesInGroupForApi(
  user: IUserWithRoles,
  tenant: string,
  groupId: string,
  orderedItems: Array<{ activityId: string; activityType: string; sortOrder: number }>,
): Promise<void> {
  if (!groupId) {
    throw new Error("Group id is required");
  }

  const { knex: db } = await createTenantKnex(tenant);
  await withTransaction(db, async (trx: Knex.Transaction) => {
    await assertCanOrganizeGroups(trx, user);

    const group = await trx("user_activity_groups")
      .where({ tenant, group_id: groupId, user_id: user.user_id })
      .first();
    if (!group) {
      throw new Error("Group not found");
    }

    for (const item of orderedItems) {
      await trx("user_activity_group_items")
        .where({
          tenant,
          group_id: groupId,
          activity_id: item.activityId,
          activity_type: item.activityType,
        })
        .update({ sort_order: item.sortOrder });
    }
  });
}
