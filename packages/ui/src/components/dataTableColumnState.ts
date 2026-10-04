import type { ColumnDefinition } from '@alga-psa/types';
import { getColumnId } from './dataTableColumnFit';

/**
 * Apply caller-controlled column visibility and order to a column list.
 *
 * Runs before the auto-fit: a column the caller hid is not a candidate for
 * the container width at all, rather than one that happened not to fit.
 * Returns the input array itself when neither control is given, so callers
 * that do not use them keep referential stability.
 */
export function applyColumnVisibilityAndOrder<T>(
  columns: ColumnDefinition<T>[],
  visibility: Record<string, boolean> | undefined,
  order: string[] | undefined,
): ColumnDefinition<T>[] {
  if (!visibility && (!order || order.length === 0)) {
    return columns;
  }

  const shown = visibility
    ? columns.filter((column) => visibility[getColumnId(column.dataIndex)] !== false)
    : columns;

  if (!order || order.length === 0) {
    return shown;
  }

  const rank = new Map(order.map((id, index) => [id, index] as const));
  return shown
    .map((column, index) => ({ column, index }))
    .sort((a, b) => {
      const rankA = rank.get(getColumnId(a.column.dataIndex));
      const rankB = rank.get(getColumnId(b.column.dataIndex));
      if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
      if (rankA !== undefined) return -1;
      if (rankB !== undefined) return 1;
      return a.index - b.index;
    })
    .map(({ column }) => column);
}
