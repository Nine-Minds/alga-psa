/**
 * Pure helpers for the "Ticket in status for N days" trigger controls (see DateTriggerStatusAgeFields).
 * Kept free of React so the option narrowing and default params are unit tested directly.
 */

export type StatusAgeParamsDraft = {
  statusName: string;
  boardId?: string | null;
  days: number;
  repeatEveryDays?: number | null;
  requireNoActivity?: boolean;
};

export type StatusAgeStatusOption = { id: string; name: string; board_id?: string | null; is_closed?: boolean | null };

export { DEFAULT_STATUS_AGE_PARAMS } from '@alga-psa/workflows/authoring';

/**
 * The status names to offer. The trigger matches by name (case-insensitive), so boards sharing a
 * name collapse to one option; once a board is chosen only that board's statuses are offered.
 * Closed statuses are skipped (the scan only matches open ones), so a name stays only while some
 * open status row in scope carries it.
 */
export function statusNameOptions(
  statuses: readonly StatusAgeStatusOption[],
  boardId: string | null | undefined,
): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();
  for (const status of statuses) {
    if (boardId && status.board_id !== boardId) continue;
    if (status.is_closed) continue;
    const name = status.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return Array.from(seen.values())
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ value: name, label: name }));
}

/** A status name that no longer exists on the chosen board (the board changed after picking it). */
export function isStatusNameAvailable(
  statuses: readonly StatusAgeStatusOption[],
  boardId: string | null | undefined,
  statusName: string,
): boolean {
  const key = statusName.trim().toLowerCase();
  return statusNameOptions(statuses, boardId).some((option) => option.value.toLowerCase() === key);
}

/** Clamps a typed number to a whole-day count in 1..365, or null for empty input. */
export function parseDayCount(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Math.trunc(Number(raw));
  if (!Number.isFinite(value)) return null;
  return Math.min(365, Math.max(1, value));
}
