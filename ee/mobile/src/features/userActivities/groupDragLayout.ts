/**
 * Pure geometry for the drag-to-organize "My groups" list.
 *
 * Kept out of the gesture component so the (historically bug-prone) hit-testing can be unit
 * tested. The list builds ONE vertical axis by summing measured row heights in render order —
 * NOT each row's onLayout `y`, which is parent-relative and not comparable across groups. The
 * axis origin is the first group header's top, which is also the top of the list-body
 * container, so a slot's derived `y` doubles as the drop indicator's `top`.
 */

import type { Activity, ActivityGroup } from "../../api/activities";
import type { DragSlot } from "./groupDragPlan";

/** Stable per-row keys, shared by the renderer (onLayout) and the layout math. */
export const itemRowKey = (groupKey: string, activity: Activity) =>
  `item:${groupKey}:${activity.type}:${activity.id}`;
export const headerRowKey = (groupKey: string) => `header:${groupKey}`;

export type RowBox = { top: number; height: number };
export type DropSlot = { y: number; slot: DragSlot };
export type DropLayout = {
  /** Each row's top + height on the derived axis, keyed by row key. */
  tops: Map<string, RowBox>;
  /** Candidate insertion points (top-of-axis `y` → target slot), in visual order. */
  slots: DropSlot[];
};

/**
 * Derive each row's position by summing heights in render order (header, then its items per
 * group; collapsed groups contribute only their header). Rows not yet measured contribute
 * height 0 — a small local skew rather than dropping out of the axis (which would pull every
 * drop toward the top group). Returns the per-row boxes and the candidate drop slots:
 *   - an expanded, non-empty group: a slot before each item and one after its last item
 *   - a collapsed or empty group: a single slot at its header → append to that group
 */
export function computeDropLayout(
  groups: ActivityGroup[],
  collapsed: ReadonlySet<string>,
  heights: ReadonlyMap<string, number>,
): DropLayout {
  const tops = new Map<string, RowBox>();
  let cum = 0;
  for (const g of groups) {
    const headerKey = headerRowKey(g.key);
    const headerHeight = heights.get(headerKey) ?? 0;
    tops.set(headerKey, { top: cum, height: headerHeight });
    cum += headerHeight;
    if (!collapsed.has(g.key)) {
      for (const activity of g.activities) {
        const key = itemRowKey(g.key, activity);
        const h = heights.get(key) ?? 0;
        tops.set(key, { top: cum, height: h });
        cum += h;
      }
    }
  }

  const slots: DropSlot[] = [];
  for (const g of groups) {
    if (collapsed.has(g.key) || g.activities.length === 0) {
      const hf = tops.get(headerRowKey(g.key));
      if (hf) slots.push({ y: hf.top + hf.height, slot: { groupKey: g.key, index: g.activities.length } });
      continue;
    }
    g.activities.forEach((activity, i) => {
      const f = tops.get(itemRowKey(g.key, activity));
      if (!f) return;
      slots.push({ y: f.top, slot: { groupKey: g.key, index: i } });
      if (i === g.activities.length - 1) slots.push({ y: f.top + f.height, slot: { groupKey: g.key, index: i + 1 } });
    });
  }
  return { tops, slots };
}

/** The drop slot whose axis-`y` is nearest the probe; null when there are no slots. */
export function nearestSlot(slots: DropSlot[], probe: number): DropSlot | null {
  let best: DropSlot | null = null;
  let bestDist = Infinity;
  for (const gap of slots) {
    const d = Math.abs(gap.y - probe);
    if (d < bestDist) {
      bestDist = d;
      best = gap;
    }
  }
  return best;
}
