/**
 * Deep link to an item on the user-activities board:
 * `/msp/user-activities?activity=<type>:<id>`. The value is the same `${type}:${id}` key the
 * grouped view uses for its rows.
 */

export const ACTIVITY_BOARD_PATH = '/msp/user-activities';
export const ACTIVITY_BOARD_PARAM = 'activity';

export interface ParsedActivityKey {
  type: string;
  id: string;
}

/** `${type}:${id}` — the key used for rows in the grouped view. */
export function buildActivityKey(type: string, id: string): string {
  return `${type}:${id}`;
}

export function buildActivityBoardHref(type: string, id: string): string {
  const params = new URLSearchParams({ [ACTIVITY_BOARD_PARAM]: buildActivityKey(type, id) });
  return `${ACTIVITY_BOARD_PATH}?${params.toString()}`;
}

/**
 * Split an activity key at the first ':' (types never contain one; ids may). Returns null
 * for anything that isn't a non-empty `type:id`.
 */
export function parseActivityKey(key: string | null | undefined): ParsedActivityKey | null {
  if (!key) return null;
  const idx = key.indexOf(':');
  if (idx <= 0 || idx === key.length - 1) return null;
  return { type: key.slice(0, idx), id: key.slice(idx + 1) };
}
