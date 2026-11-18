/**
 * Sort keys accepted by GET /api/v1/time-sheets.
 * Lives apart from TimeSheetService so the schema module can use it without importing the service.
 * The key -> SQL mapping is TIME_SHEET_LIST_SORT_SQL in TimeSheetService.ts.
 */
export const TIME_SHEET_LIST_SORT_KEYS = [
  'approval_status',
  'approved_at',
  'period_end',
  'period_start',
  'submitted_at',
] as const;

export type TimeSheetListSortKey = (typeof TIME_SHEET_LIST_SORT_KEYS)[number];

export const TIME_SHEET_LIST_DEFAULT_SORT: TimeSheetListSortKey = 'period_start';

/** time_sheets has no created_at column; it is accepted as a legacy alias of the default sort. */
export const TIME_SHEET_LIST_SORT_ALIASES: Record<string, TimeSheetListSortKey> = {
  created_at: 'period_start',
};
