/**
 * `boards.enable_live_ticket_timer` keeps its name and API shape but now means
 * "show the stopwatch on tickets in this board" (plan D12).
 *
 * This is the single home of the default: a missing/null value means enabled, so
 * boards that predate the column keep the stopwatch. Do not write `?? true` for this
 * setting anywhere else.
 *
 * Note: `@alga-psa/scheduling` (stopwatchCore.startSession) cannot import this package,
 * so it mirrors the rule as `enable_live_ticket_timer === false` => rejected. Keep the two in sync.
 */

export const DEFAULT_BOARD_STOPWATCH_ENABLED = true;

type BoardStopwatchFlag = boolean | null | undefined;

/** Resolve the effective on/off value from a raw column value. */
export function resolveBoardStopwatchEnabled(value: BoardStopwatchFlag): boolean {
  return value ?? DEFAULT_BOARD_STOPWATCH_ENABLED;
}

/** Return the board with a null/undefined setting replaced by the default (same object when already set). */
export function normalizeBoardStopwatchSetting<T extends { enable_live_ticket_timer?: BoardStopwatchFlag }>(
  board: T,
): T {
  if (!board || (board.enable_live_ticket_timer !== null && board.enable_live_ticket_timer !== undefined)) {
    return board;
  }
  return { ...board, enable_live_ticket_timer: DEFAULT_BOARD_STOPWATCH_ENABLED };
}

/** Existing board-object convenience wrapper. */
export function isBoardLiveTicketTimerEnabled(
  board: { enable_live_ticket_timer?: BoardStopwatchFlag } | null | undefined,
): boolean {
  return resolveBoardStopwatchEnabled(board?.enable_live_ticket_timer);
}
