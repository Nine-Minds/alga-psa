import { describe, expect, it } from "vitest";
import { activityTypeColor, buildCustomGroups, UNGROUPED_KEY } from "./activityHelpers";
import type { Activity, CustomActivityGroup, MobileActivityType } from "../../api/activities";
import type { Theme } from "../../ui/themes";

// Minimal Activity — buildCustomGroups only reads `id` + `type`.
function act(id: string, type: MobileActivityType): Activity {
  return { id, type, title: `${type}:${id}` } as unknown as Activity;
}

function group(
  groupId: string,
  groupName: string,
  sortOrder: number,
  items: Array<{ activityId: string; activityType: string; sortOrder: number }>,
): CustomActivityGroup {
  return {
    groupId,
    groupName,
    sortOrder,
    isCollapsed: false,
    items: items.map((it, i) => ({ itemId: `${groupId}-${i}`, ...it })),
  };
}

describe("buildCustomGroups", () => {
  it("buckets activities into groups (group + item order preserved) with a trailing Ungrouped", () => {
    const activities = [
      act("a", "ticket"),
      act("b", "projectTask"),
      act("c", "workflowTask"),
      act("loose", "schedule"),
    ];
    // Intentionally out of order to prove sorting by sortOrder.
    const groups = [
      group("g2", "Second", 1, [{ activityId: "c", activityType: "workflowTask", sortOrder: 0 }]),
      group("g1", "First", 0, [
        { activityId: "b", activityType: "projectTask", sortOrder: 1 },
        { activityId: "a", activityType: "ticket", sortOrder: 0 },
      ]),
    ];

    const result = buildCustomGroups(activities, groups);

    // Groups sorted by sortOrder; Ungrouped last.
    expect(result.map((g) => g.key)).toEqual(["g1", "g2", UNGROUPED_KEY]);
    // Items sorted by their sortOrder within the group.
    expect(result[0].activities.map((a) => a.id)).toEqual(["a", "b"]);
    expect(result[0].count).toBe(2);
    expect(result[1].activities.map((a) => a.id)).toEqual(["c"]);
    // Leftover lands in Ungrouped.
    expect(result[2].activities.map((a) => a.id)).toEqual(["loose"]);
  });

  it("skips items whose activity isn't in the current set (filtered out / deleted)", () => {
    const activities = [act("a", "ticket")];
    const groups = [
      group("g1", "First", 0, [
        { activityId: "a", activityType: "ticket", sortOrder: 0 },
        { activityId: "ghost", activityType: "ticket", sortOrder: 1 },
      ]),
    ];

    const result = buildCustomGroups(activities, groups);

    expect(result[0].activities.map((a) => a.id)).toEqual(["a"]);
    expect(result[0].count).toBe(1);
    // "a" was claimed, nothing else remains, so there is no Ungrouped bucket.
    expect(result.some((g) => g.key === UNGROUPED_KEY)).toBe(false);
  });

  it("matches on type + id, so same id under different types is not cross-claimed", () => {
    const activities = [act("dup", "ticket"), act("dup", "projectTask")];
    const groups = [group("g1", "First", 0, [{ activityId: "dup", activityType: "ticket", sortOrder: 0 }])];

    const result = buildCustomGroups(activities, groups);

    expect(result[0].activities).toEqual([activities[0]]); // only the ticket
    const ungrouped = result.find((g) => g.key === UNGROUPED_KEY)!;
    expect(ungrouped.activities).toEqual([activities[1]]); // the projectTask stays ungrouped
  });

  it("does not double-claim an activity listed in two groups (first group wins)", () => {
    const activities = [act("a", "ticket")];
    const groups = [
      group("g1", "First", 0, [{ activityId: "a", activityType: "ticket", sortOrder: 0 }]),
      group("g2", "Second", 1, [{ activityId: "a", activityType: "ticket", sortOrder: 0 }]),
    ];

    const result = buildCustomGroups(activities, groups);

    expect(result[0].activities.map((a) => a.id)).toEqual(["a"]);
    expect(result[1].activities).toEqual([]); // already claimed by g1
    expect(result[1].count).toBe(0);
  });

  it("keeps empty groups (count 0) and omits Ungrouped when everything is grouped", () => {
    const activities = [act("a", "ticket")];
    const groups = [
      group("g1", "First", 0, [{ activityId: "a", activityType: "ticket", sortOrder: 0 }]),
      group("g2", "Empty", 1, []),
    ];

    const result = buildCustomGroups(activities, groups);

    expect(result.map((g) => g.key)).toEqual(["g1", "g2"]); // no Ungrouped
    expect(result[1].count).toBe(0);
    expect(result[1].activities).toEqual([]);
  });

  it("returns a single Ungrouped bucket when there are no groups", () => {
    const result = buildCustomGroups([act("a", "ticket")], []);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe(UNGROUPED_KEY);
    expect(result[0].activities.map((a) => a.id)).toEqual(["a"]);
  });
});

describe("activityTypeColor (web main-app alignment)", () => {
  // Each token maps to its own name so the assertions read as "type -> token".
  const theme = {
    colors: {
      primary: "primary",
      secondary: "secondary",
      cyan: "cyan",
      success: "success",
      orange: "orange",
      warning: "warning",
      accent: "accent",
      indigo: "indigo",
      info: "info",
      textSecondary: "textSecondary",
    },
  } as unknown as Theme;

  it.each([
    ["ticket", "primary"],
    ["projectTask", "cyan"],
    ["schedule", "success"],
    ["timeEntry", "orange"],
    ["workflowTask", "accent"],
    ["notification", "indigo"],
    ["document", "textSecondary"],
  ] as Array<[MobileActivityType, string]>)("%s -> %s", (type, token) => {
    expect(activityTypeColor(type, theme)).toBe(token);
  });
});
