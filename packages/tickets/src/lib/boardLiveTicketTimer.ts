export function isBoardLiveTicketTimerEnabled(board: { enable_live_ticket_timer?: boolean | null } | null | undefined): boolean {
  // Missing/null values should preserve existing enabled behavior.
  return board?.enable_live_ticket_timer ?? true;
}
