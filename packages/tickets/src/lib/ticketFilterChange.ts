/**
 * Out-of-band hints a filter change can carry to the container alongside the
 * filter values themselves. Board tabs are route state, so a tab click needs to
 * say "this is a navigation" — the container writes history and the last-active
 * board preference from that, instead of trying to infer intent from the diff.
 */
export interface TicketFilterChangeOptions {
  /**
   * Push a history entry instead of replacing the current one. Ordinary filter
   * edits replace (they are refinements of one view); moving between board tabs
   * pushes, so browser back/forward walks the tabs.
   */
  pushHistory?: boolean;
  /**
   * Board tab this change came from: a board id, or null for "All tickets".
   * Presence (not truthiness) is what marks the change as a tab navigation, so
   * selecting "All tickets" persists as "all" rather than as "no opinion".
   */
  activeBoardTab?: string | null;
}
