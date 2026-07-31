import { describe, expect, it } from "vitest";
import type { Activity, ActivityGroup } from "../../api/activities";
import { computeDropLayout, headerRowKey, itemRowKey, nearestSlot } from "./groupDragLayout";

const act = (id: string, type: Activity["type"] = "ticket"): Activity => ({ id, type }) as unknown as Activity;

const group = (key: string, ids: string[]): ActivityGroup => {
  const activities = ids.map((id) => act(id));
  return { key, label: key, count: activities.length, activities };
};

// Uniform 100px headers and items make the expected axis positions easy to read.
const H = 100;
const evenHeights = (groups: ActivityGroup[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const g of groups) {
    m.set(headerRowKey(g.key), H);
    for (const a of g.activities) m.set(itemRowKey(g.key, a), H);
  }
  return m;
};

describe("computeDropLayout", () => {
  it("derives a single monotonic axis by summing heights in render order", () => {
    const groups = [group("g1", ["a", "b"]), group("g2", ["c"])];
    const { tops } = computeDropLayout(groups, new Set(), evenHeights(groups));

    // g1 header @0, a @100, b @200, g2 header @300, c @400 — one continuous axis across groups.
    expect(tops.get(headerRowKey("g1"))).toEqual({ top: 0, height: H });
    expect(tops.get(itemRowKey("g1", act("a")))).toEqual({ top: 100, height: H });
    expect(tops.get(itemRowKey("g1", act("b")))).toEqual({ top: 200, height: H });
    expect(tops.get(headerRowKey("g2"))).toEqual({ top: 300, height: H });
    expect(tops.get(itemRowKey("g2", act("c")))).toEqual({ top: 400, height: H });
  });

  it("emits a before-slot per item and an after-slot for the last item of each group", () => {
    const groups = [group("g1", ["a", "b"]), group("g2", ["c"])];
    const { slots } = computeDropLayout(groups, new Set(), evenHeights(groups));

    expect(slots).toEqual([
      { y: 100, slot: { groupKey: "g1", index: 0 } }, // before a
      { y: 200, slot: { groupKey: "g1", index: 1 } }, // before b
      { y: 300, slot: { groupKey: "g1", index: 2 } }, // after last of g1
      { y: 400, slot: { groupKey: "g2", index: 0 } }, // before c
      { y: 500, slot: { groupKey: "g2", index: 1 } }, // after last of g2
    ]);
  });

  it("offers a single append-slot at the header for a collapsed group (and skips its items in the axis)", () => {
    const groups = [group("g1", ["a", "b"]), group("g2", ["c"])];
    const collapsed = new Set(["g1"]);
    const { slots, tops } = computeDropLayout(groups, collapsed, evenHeights(groups));

    // g1's items are not laid out, so g2's header follows g1's header directly.
    expect(tops.get(headerRowKey("g2"))).toEqual({ top: 100, height: H });
    expect(slots).toContainEqual({ y: 100, slot: { groupKey: "g1", index: 2 } }); // append to collapsed g1
    expect(slots.some((s) => s.slot.groupKey === "g1" && s.slot.index < 2)).toBe(false);
  });

  it("offers an append-slot at the header for an empty group", () => {
    const groups = [group("g1", []), group("g2", ["c"])];
    const { slots } = computeDropLayout(groups, new Set(), evenHeights(groups));
    expect(slots).toContainEqual({ y: 100, slot: { groupKey: "g1", index: 0 } });
  });

  it("treats an unmeasured row as height 0 instead of dropping it from the axis", () => {
    const groups = [group("g1", ["a", "b"])];
    const heights = new Map<string, number>([
      [headerRowKey("g1"), H],
      // item "a" intentionally unmeasured
      [itemRowKey("g1", act("b")), H],
    ]);
    const { tops } = computeDropLayout(groups, new Set(), heights);
    expect(tops.get(itemRowKey("g1", act("a")))).toEqual({ top: 100, height: 0 });
    // b still follows on the axis (a contributed 0), so later rows never collapse to the top.
    expect(tops.get(itemRowKey("g1", act("b")))).toEqual({ top: 100, height: H });
  });
});

describe("nearestSlot", () => {
  const groups = [group("g1", ["a", "b"]), group("g2", ["c"])];
  const { slots } = computeDropLayout(groups, new Set(), evenHeights(groups));

  it("resolves a probe deep in the second group to that group (the original cross-group bug)", () => {
    // Drag the first card (axis top 100, center +50 → 150) down by +260 → probe 410, inside g2.
    const best = nearestSlot(slots, 150 + 260);
    expect(best?.slot).toEqual({ groupKey: "g2", index: 0 });
  });

  it("resolves a small nudge to a neighboring slot within the same group", () => {
    const best = nearestSlot(slots, 210); // just past 'before b' @200
    expect(best?.slot).toEqual({ groupKey: "g1", index: 1 });
  });

  it("returns null when there are no slots", () => {
    expect(nearestSlot([], 123)).toBeNull();
  });
});
