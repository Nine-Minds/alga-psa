/**
 * Ticket statuses belong to a board, so one name ("Awaiting Wisdom") can exist once per board.
 * A condition on "status is Awaiting Wisdom" usually means every board's copy, which is stored as
 * an `in` list of all the status ids that share the name. These helpers translate between that
 * list and the single "Awaiting Wisdom (any board)" choice shown in the builder.
 */

export type WorkflowStatusRef = {
  id: string;
  name: string;
  board_id?: string | null;
  board_name?: string | null;
};

/** Picker value for "<name> (any board)". It never reaches a saved expression. */
export const ANY_BOARD_STATUS_PREFIX = 'any-board-status:';

export const toAnyBoardStatusValue = (name: string): string => `${ANY_BOARD_STATUS_PREFIX}${name}`;

export const parseAnyBoardStatusValue = (value: unknown): string | null =>
  typeof value === 'string' && value.startsWith(ANY_BOARD_STATUS_PREFIX)
    ? value.slice(ANY_BOARD_STATUS_PREFIX.length)
    : null;

/** Status ids for each name that exists on more than one board. */
export const groupSharedStatusIds = (statuses: readonly WorkflowStatusRef[]): Map<string, string[]> => {
  const byName = new Map<string, string[]>();
  for (const status of statuses) {
    if (!status.id || !status.name) continue;
    const ids = byName.get(status.name) ?? [];
    ids.push(status.id);
    byName.set(status.name, ids);
  }
  for (const [name, ids] of byName) {
    if (ids.length < 2) byName.delete(name);
  }
  return byName;
};

/** The shared name whose ids are exactly `values`, or null. */
export const findAnyBoardStatusName = (
  statuses: readonly WorkflowStatusRef[] | undefined,
  values: readonly unknown[]
): string | null => {
  if (!statuses?.length || values.length < 2) return null;
  const wanted = new Set(values);
  if (wanted.size !== values.length) return null;
  for (const [name, ids] of groupSharedStatusIds(statuses)) {
    if (ids.length === wanted.size && ids.every((id) => wanted.has(id))) return name;
  }
  return null;
};

export const statusIdsForName = (statuses: readonly WorkflowStatusRef[] | undefined, name: string): string[] =>
  groupSharedStatusIds(statuses ?? []).get(name) ?? [];
