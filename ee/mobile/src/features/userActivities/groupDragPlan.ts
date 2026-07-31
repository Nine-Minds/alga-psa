/**
 * Pure drop-planning for drag-to-organize of the "My groups" view.
 *
 * Given the current grouped arrangement and a (from → to) slot, compute the optimistic next
 * arrangement plus the single server mutation to persist. Kept free of React/RN so the index
 * math is unit-testable in isolation (mirrors `activityFilters`). Semantics mirror the web's
 * `GroupedActivitiesView.handleDragEnd`:
 *   - reorder within a custom group  → reorderActivitiesInGroup
 *   - move into a custom group       → moveActivityToGroup (at the drop index)
 *   - drop into the Ungrouped bucket → removeActivityFromGroups
 *   - reordering within Ungrouped is not persisted (no stored order) → noop
 */

import type { Activity, ActivityGroup } from "../../api/activities";
import { UNGROUPED_KEY } from "./activityHelpers";

/** A drop position: an insertion index within a group bucket. */
export type DragSlot = { groupKey: string; index: number };

export type GroupDragMutation =
  | { kind: "noop" }
  | {
      kind: "reorder";
      groupKey: string;
      items: Array<{ activityId: string; activityType: string; sortOrder: number }>;
    }
  | { kind: "move"; groupKey: string; activityId: string; activityType: string; sortOrder: number }
  | { kind: "remove"; activityId: string; activityType: string };

export type GroupDragPlan = {
  /** Optimistic arrangement to render immediately (counts recomputed). */
  nextGroups: ActivityGroup[];
  mutation: GroupDragMutation;
};

const orderOf = (activities: Activity[]) =>
  activities.map((a, i) => ({ activityId: a.id, activityType: a.type, sortOrder: i }));

/**
 * Plan the result of dragging the activity at `from` to insertion slot `to`.
 * Returns the original groups + a `noop` when nothing meaningfully changed (so the caller
 * can skip both the optimistic update and the network call, letting the card snap back).
 */
export function planGroupDrag(
  groups: ActivityGroup[],
  from: DragSlot,
  to: DragSlot,
): GroupDragPlan {
  const noop: GroupDragPlan = { nextGroups: groups, mutation: { kind: "noop" } };

  const srcIdx = groups.findIndex((g) => g.key === from.groupKey);
  const dstIdx = groups.findIndex((g) => g.key === to.groupKey);
  if (srcIdx === -1 || dstIdx === -1) return noop;

  const activity = groups[srcIdx].activities[from.index];
  if (!activity) return noop;

  const sameGroup = from.groupKey === to.groupKey;

  // Build the next arrangement: pull the activity out of its source, then insert into the
  // destination at the (post-removal-adjusted, clamped) index.
  const next: ActivityGroup[] = groups.map((g) => ({ ...g, activities: [...g.activities] }));
  next[srcIdx].activities.splice(from.index, 1);

  let insertAt = to.index;
  // Removing an earlier element in the same group shifts later indices down by one.
  if (sameGroup && to.index > from.index) insertAt -= 1;
  insertAt = Math.max(0, Math.min(insertAt, next[dstIdx].activities.length));

  if (sameGroup && insertAt === from.index) return noop;

  next[dstIdx].activities.splice(insertAt, 0, activity);
  for (const g of next) g.count = g.activities.length;

  if (sameGroup) {
    // Ungrouped has no persisted order — it's rebuilt from the server's default sort on every
    // load, so a reorder there would flash "moved" then snap back. Skip it.
    if (from.groupKey === UNGROUPED_KEY) return noop;
    return {
      nextGroups: next,
      mutation: { kind: "reorder", groupKey: from.groupKey, items: orderOf(next[dstIdx].activities) },
    };
  }

  if (to.groupKey === UNGROUPED_KEY) {
    return {
      nextGroups: next,
      mutation: { kind: "remove", activityId: activity.id, activityType: activity.type },
    };
  }

  return {
    nextGroups: next,
    mutation: {
      kind: "move",
      groupKey: to.groupKey,
      activityId: activity.id,
      activityType: activity.type,
      sortOrder: insertAt,
    },
  };
}
