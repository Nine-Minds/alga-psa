/**
 * Pure, client-safe helpers that bucket a user's activities into their custom groups.
 *
 * No server imports: this module is shared by the grouped view, the print view and any
 * future picker so every surface agrees on where an activity lives.
 *
 * Rule: an activity with a membership row in one of the groups is "pinned" there. Activities
 * with no membership land in the group flagged `isDefault` (listed first, in input order,
 * followed by pinned items in membership order); without a default they are `ungrouped`.
 *
 * Mobile mirrors this rule in ee/mobile/src/features/userActivities/activityHelpers.ts.
 */

export interface PartitionActivity {
  id: string;
  type: string;
}

export interface PartitionGroupItem {
  activityId: string;
  activityType: string;
}

export interface PartitionGroup {
  isDefault?: boolean;
  items: PartitionGroupItem[];
}

export interface PartitionedGroup<A, G> {
  group: G;
  /** Displayed order: (default group only) unpinned first, then pinned in membership order */
  activities: A[];
  /** Number of activities explicitly pinned to this group (the tail of `activities`) */
  pinnedCount: number;
}

export interface PartitionResult<A, G> {
  groups: Array<PartitionedGroup<A, G>>;
  ungrouped: A[];
}

const activityKey = (a: PartitionActivity) => `${a.type}:${a.id}`;

export function partitionActivitiesByGroup<A extends PartitionActivity, G extends PartitionGroup>(
  activities: A[],
  groups: G[],
): PartitionResult<A, G> {
  const activityByKey = new Map<string, A>();
  for (const a of activities) {
    activityByKey.set(activityKey(a), a);
  }

  const assignedKeys = new Set<string>();
  const partitioned = groups.map((group) => {
    const pinned: A[] = [];
    for (const item of group.items) {
      const key = `${item.activityType}:${item.activityId}`;
      const act = activityByKey.get(key);
      // Skip memberships for activities not in view, and guard against duplicates
      if (act && !assignedKeys.has(key)) {
        pinned.push(act);
        assignedKeys.add(key);
      }
    }
    return { group, activities: pinned, pinnedCount: pinned.length };
  });

  const unpinned = activities.filter((a) => !assignedKeys.has(activityKey(a)));
  const defaultEntry = partitioned.find((p) => p.group.isDefault);
  if (defaultEntry) {
    defaultEntry.activities = [...unpinned, ...defaultEntry.activities];
    return { groups: partitioned, ungrouped: [] };
  }
  return { groups: partitioned, ungrouped: unpinned };
}

/**
 * Single-item variant of {@link partitionActivitiesByGroup}: which group does this activity
 * show in? Returns the pinned group, else the default group, else null (Ungrouped).
 */
export function resolveActivityGroup<G extends PartitionGroup>(
  activity: PartitionActivity,
  groups: G[],
): { group: G; pinned: boolean } | null {
  for (const group of groups) {
    if (group.items.some((i) => i.activityId === activity.id && i.activityType === activity.type)) {
      return { group, pinned: true };
    }
  }
  const def = groups.find((g) => g.isDefault);
  return def ? { group: def, pinned: false } : null;
}
