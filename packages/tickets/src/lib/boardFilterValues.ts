/**
 * Sentinel board-filter selection meaning "tickets that have no board assigned".
 *
 * Lives in lib (not in BoardFilterPicker) so pure board-filter logic — the tab
 * strip derivation in ./boardTabs — can reason about it without importing a
 * client component. BoardFilterPicker re-exports it for existing consumers.
 */
export const NO_BOARD_VALUE = 'no-board';
