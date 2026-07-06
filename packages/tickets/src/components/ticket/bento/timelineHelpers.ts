/**
 * Pure helpers for the Grid-layout timeline tile: lane classification,
 * chronological sorting, lane filtering, and day-break labeling. Kept separate
 * from the React component so the ordering/grouping rules can be unit-tested.
 */

import type { TicketTimelineEntryType } from '@alga-psa/shared/lib/ticketActivity';

export type Lane = 'reply' | 'time' | 'system' | 'alert';
export type LaneFilter = 'everything' | Lane;

export interface TimelineNodeLike {
  lane: Lane;
  occurredAt: string;
  sortId: string;
}

/** Map a raw unified-timeline entry type onto a display lane. */
export function laneForEntryType(type: TicketTimelineEntryType): Lane {
  switch (type) {
    case 'comment':
      return 'reply';
    case 'time_entry':
      return 'time';
    case 'alert':
      return 'alert';
    case 'activity':
    default:
      return 'system';
  }
}

/**
 * Sort timeline nodes chronologically. Ties on the same timestamp break
 * deterministically by sortId, matching the shared timeline builder so the
 * inline stream and the server payload agree on ordering.
 */
export function sortTimelineNodes<T extends TimelineNodeLike>(nodes: T[], order: 'asc' | 'desc'): T[] {
  const sorted = [...nodes];
  sorted.sort((a, b) => {
    if (a.occurredAt === b.occurredAt) {
      return order === 'asc' ? a.sortId.localeCompare(b.sortId) : b.sortId.localeCompare(a.sortId);
    }
    return order === 'asc'
      ? a.occurredAt.localeCompare(b.occurredAt)
      : b.occurredAt.localeCompare(a.occurredAt);
  });
  return sorted;
}

/** Count nodes per lane (used for the filter-pill badges). */
export function laneCounts(nodes: TimelineNodeLike[]): Record<Lane, number> {
  const counts: Record<Lane, number> = { reply: 0, time: 0, system: 0, alert: 0 };
  for (const node of nodes) counts[node.lane] += 1;
  return counts;
}

/** Reduce nodes to a single lane; 'everything' passes them all through. */
export function filterByLane<T extends TimelineNodeLike>(nodes: T[], filter: LaneFilter): T[] {
  if (filter === 'everything') return nodes;
  return nodes.filter((node) => node.lane === filter);
}

/**
 * Short calendar-day label for a day-break separator. Uses `now` (defaults to
 * the current time) to decide whether the day is "Today". Same-year days omit
 * the year; other years include it.
 */
export function dayLabel(isoOrDate: string | Date, now: Date = new Date()): string {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  if (d.toDateString() === now.toDateString()) return 'Today';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/**
 * Walk sorted nodes and mark where a new day begins. Returns each node paired
 * with the day label to show above it (or null when it shares the prior day).
 */
export function withDayBreaks<T extends TimelineNodeLike>(
  nodes: T[],
  now: Date = new Date(),
): Array<{ node: T; dayBreak: string | null }> {
  let lastDay: string | null = null;
  return nodes.map((node) => {
    const label = dayLabel(node.occurredAt, now);
    const dayBreak = label !== lastDay ? label : null;
    lastDay = label;
    return { node, dayBreak };
  });
}
