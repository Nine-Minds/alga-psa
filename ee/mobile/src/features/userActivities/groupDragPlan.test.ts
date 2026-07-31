import { describe, expect, it } from "vitest";
import type { Activity, ActivityGroup } from "../../api/activities";
import { UNGROUPED_KEY } from "./activityHelpers";
import { planGroupDrag } from "./groupDragPlan";

// The planner only reads `id`/`type`; keep fixtures minimal and cast to the union.
const act = (id: string, type: Activity["type"] = "ticket"): Activity =>
  ({ id, type }) as unknown as Activity;

const group = (key: string, ids: string[]): ActivityGroup => {
  const activities = ids.map((id) => act(id));
  return { key, label: key, count: activities.length, activities };
};

const ungrouped = (ids: string[]): ActivityGroup => ({
  key: UNGROUPED_KEY,
  label: "Ungrouped",
  count: ids.length,
  activities: ids.map((id) => act(id)),
});

const idsOf = (g: ActivityGroup) => g.activities.map((a) => a.id);
const byKey = (groups: ActivityGroup[], key: string) => groups.find((g) => g.key === key)!;

describe("planGroupDrag", () => {
  it("reorders within a custom group and persists the new order", () => {
    const groups = [group("g1", ["a", "b", "c"])];
    const plan = planGroupDrag(groups, { groupKey: "g1", index: 0 }, { groupKey: "g1", index: 3 });

    expect(idsOf(byKey(plan.nextGroups, "g1"))).toEqual(["b", "c", "a"]);
    expect(plan.mutation).toEqual({
      kind: "reorder",
      groupKey: "g1",
      items: [
        { activityId: "b", activityType: "ticket", sortOrder: 0 },
        { activityId: "c", activityType: "ticket", sortOrder: 1 },
        { activityId: "a", activityType: "ticket", sortOrder: 2 },
      ],
    });
  });

  it("moves an activity into another custom group at the drop index", () => {
    const groups = [group("g1", ["a", "b"]), group("g2", ["x", "y"])];
    const plan = planGroupDrag(groups, { groupKey: "g1", index: 0 }, { groupKey: "g2", index: 1 });

    expect(idsOf(byKey(plan.nextGroups, "g1"))).toEqual(["b"]);
    expect(idsOf(byKey(plan.nextGroups, "g2"))).toEqual(["x", "a", "y"]);
    expect(plan.mutation).toEqual({
      kind: "move",
      groupKey: "g2",
      activityId: "a",
      activityType: "ticket",
      sortOrder: 1,
    });
    // Counts are recomputed on the optimistic arrangement.
    expect(byKey(plan.nextGroups, "g1").count).toBe(1);
    expect(byKey(plan.nextGroups, "g2").count).toBe(3);
  });

  it("moving from ungrouped into a group is a move (not a remove)", () => {
    const groups = [group("g1", ["a"]), ungrouped(["u1", "u2"])];
    const plan = planGroupDrag(groups, { groupKey: UNGROUPED_KEY, index: 1 }, { groupKey: "g1", index: 0 });

    expect(plan.mutation).toEqual({
      kind: "move",
      groupKey: "g1",
      activityId: "u2",
      activityType: "ticket",
      sortOrder: 0,
    });
    expect(idsOf(byKey(plan.nextGroups, "g1"))).toEqual(["u2", "a"]);
  });

  it("dropping a grouped item into Ungrouped removes it from the group", () => {
    const groups = [group("g1", ["a", "b"]), ungrouped(["u1"])];
    const plan = planGroupDrag(groups, { groupKey: "g1", index: 1 }, { groupKey: UNGROUPED_KEY, index: 0 });

    expect(plan.mutation).toEqual({ kind: "remove", activityId: "b", activityType: "ticket" });
    expect(idsOf(byKey(plan.nextGroups, "g1"))).toEqual(["a"]);
    expect(idsOf(byKey(plan.nextGroups, UNGROUPED_KEY))).toEqual(["b", "u1"]);
  });

  it("reordering within Ungrouped is a noop (no persisted order)", () => {
    const groups = [ungrouped(["u1", "u2", "u3"])];
    const plan = planGroupDrag(groups, { groupKey: UNGROUPED_KEY, index: 0 }, { groupKey: UNGROUPED_KEY, index: 2 });

    expect(plan.mutation).toEqual({ kind: "noop" });
    expect(plan.nextGroups).toBe(groups);
  });

  it("dropping an item back onto its own slot is a noop", () => {
    const groups = [group("g1", ["a", "b", "c"])];
    expect(planGroupDrag(groups, { groupKey: "g1", index: 1 }, { groupKey: "g1", index: 1 }).mutation).toEqual({
      kind: "noop",
    });
    // Dropping just after itself collapses to the same position too.
    expect(planGroupDrag(groups, { groupKey: "g1", index: 1 }, { groupKey: "g1", index: 2 }).mutation).toEqual({
      kind: "noop",
    });
  });

  it("returns a noop for an out-of-range or unknown source", () => {
    const groups = [group("g1", ["a"])];
    expect(planGroupDrag(groups, { groupKey: "nope", index: 0 }, { groupKey: "g1", index: 0 }).mutation).toEqual({
      kind: "noop",
    });
    expect(planGroupDrag(groups, { groupKey: "g1", index: 5 }, { groupKey: "g1", index: 0 }).mutation).toEqual({
      kind: "noop",
    });
  });
});
