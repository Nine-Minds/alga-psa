import type { TicketStatus } from "../api/tickets";

/**
 * Status filters are stored by name, not id: status ids are board-specific,
 * so a saved id list only ever matched the boards that existed when the user
 * picked it and silently hid tickets from every other board.
 */
export type StatusGroup = { name: string; ids: string[]; isClosed: boolean };

export function groupStatusesByName(statuses: TicketStatus[]): StatusGroup[] {
  const map = new Map<string, TicketStatus[]>();
  for (const status of statuses) {
    const existing = map.get(status.name);
    if (existing) existing.push(status);
    else map.set(status.name, [status]);
  }
  return Array.from(map.entries()).map(([name, group]) => ({
    name,
    ids: group.map((status) => status.status_id),
    isClosed: group[0].is_closed,
  }));
}

export function resolveStatusIdsByName(statuses: TicketStatus[], names: string[]): string[] {
  if (names.length === 0) return [];
  const wanted = new Set(names);
  return statuses.filter((status) => wanted.has(status.name)).map((status) => status.status_id);
}

/** Recover names for a legacy id-based selection so it can be re-saved by name. */
export function statusNamesFromIds(statuses: TicketStatus[], ids: string[]): string[] {
  if (ids.length === 0) return [];
  const wanted = new Set(ids);
  return [...new Set(statuses.filter((status) => wanted.has(status.status_id)).map((status) => status.name))];
}
