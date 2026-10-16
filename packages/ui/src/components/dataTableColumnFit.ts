import { ColumnDefinition } from '@alga-psa/types';

// Fallback design width used to resolve percent widths before the container has been measured.
export const COLUMN_SIZE_BASE_WIDTH = 1800;
const DEFAULT_COLUMN_SIZE = 160;
// Subtracted from the measured container width when resolving percent widths so rounding and
// min-size clamping of narrow columns can't push a 100%-sum table a few pixels past the
// container (which would needlessly hide its last column). minWidth: 100% stretches the slack
// back out when the table renders.
const CONTAINER_GUTTER = 12;
const COMPACT_COLUMN_IDS = new Set(['selection', 'checkbox', 'select', 'actions', 'action', 'tags']);
const SELECTION_COLUMN_IDS = new Set(['selection', 'checkbox', 'select']);

export const getColumnId = (column: Pick<ColumnDefinition<any>, 'id' | 'dataIndex'>): string => (
  column.id ?? (Array.isArray(column.dataIndex) ? column.dataIndex.join('_') : column.dataIndex)
);

/**
 * Give every column a distinct id. DataTable keys columns (cells, sizing, sorting, visibility)
 * by id, so two columns sharing one would otherwise render the first column's cell twice.
 * Later duplicates get `<id>__2`, `<id>__3`, …; returns the input array when nothing collides.
 */
export const withUniqueColumnIds = <T,>(columns: ColumnDefinition<T>[]): ColumnDefinition<T>[] => {
  const seen = new Map<string, number>();
  let changed = false;
  const result = columns.map((column) => {
    const baseId = getColumnId(column);
    const count = (seen.get(baseId) ?? 0) + 1;
    seen.set(baseId, count);
    if (count === 1) return column;
    changed = true;
    let candidate = `${baseId}__${count}`;
    while (seen.has(candidate)) candidate = `${candidate}_`;
    seen.set(candidate, 1);
    return { ...column, id: candidate };
  });
  return changed ? result : columns;
};

// Percent widths are resolved against the measured container width (percentBase) so a table
// whose columns sum to 100% always fits its container. percentScale normalizes declared
// percentages when they add up to more than 100%.
export interface ColumnLayoutContext {
  percentBase: number;
  percentScale: number;
}

export const DEFAULT_COLUMN_LAYOUT: ColumnLayoutContext = {
  percentBase: COLUMN_SIZE_BASE_WIDTH,
  percentScale: 1,
};

export const getPercentWidth = (width: string | undefined): number | undefined => {
  if (!width) return undefined;

  const trimmed = width.trim();
  if (!trimmed.endsWith('%')) return undefined;

  const percent = Number.parseFloat(trimmed);
  return Number.isFinite(percent) ? percent : undefined;
};

export const getPercentScale = (columns: ColumnDefinition<any>[]): number => {
  const totalPercent = columns.reduce((sum, col) => sum + (getPercentWidth(col.width) ?? 0), 0);
  return totalPercent > 100 ? 100 / totalPercent : 1;
};

export const getColumnLayout = (
  columns: ColumnDefinition<any>[],
  containerWidth: number
): ColumnLayoutContext => ({
  percentBase: containerWidth ? Math.max(containerWidth - CONTAINER_GUTTER, 0) : COLUMN_SIZE_BASE_WIDTH,
  percentScale: getPercentScale(columns),
});

export const parseColumnWidth = (
  width: string | undefined,
  layout: ColumnLayoutContext
): number | undefined => {
  if (!width) return undefined;

  const trimmed = width.trim();
  if (trimmed.endsWith('px')) {
    const px = Number.parseFloat(trimmed);
    return Number.isFinite(px) ? Math.round(px) : undefined;
  }

  const percent = getPercentWidth(trimmed);
  if (percent !== undefined) {
    // Floor so a set of percentages summing to 100% never overshoots the container by rounding.
    return Math.floor(((percent * layout.percentScale) / 100) * layout.percentBase);
  }

  // A `rem` width used to fall through to the bare-number branch, so '18rem'
  // silently became 18 pixels and the column collapsed to its minimum — a
  // plausible input producing a wrong answer with no error.
  if (trimmed.endsWith('rem')) {
    const rem = Number.parseFloat(trimmed);
    return Number.isFinite(rem) ? Math.round(rem * 16) : undefined;
  }

  const numeric = Number.parseFloat(trimmed);
  return Number.isFinite(numeric) ? Math.round(numeric) : undefined;
};

const clampSize = (size: number, minSize: number, maxSize: number): number => (
  Math.min(Math.max(size, minSize), maxSize)
);

// Absolute floor for a declared `minWidth`, so a typo can't collapse a column.
const MIN_WIDTH_FLOOR = 40;

// Only px/rem are honored for `minWidth`; a percent (or bare number) is ignored because a
// minimum has to be a fixed size that doesn't depend on the container.
const parseMinWidth = (
  minWidth: string | undefined,
  layout: ColumnLayoutContext
): number | undefined => {
  if (!minWidth) return undefined;
  const trimmed = minWidth.trim();
  if (!trimmed.endsWith('px') && !trimmed.endsWith('rem')) return undefined;
  const parsed = parseColumnWidth(trimmed, layout);
  return parsed === undefined ? undefined : Math.max(parsed, MIN_WIDTH_FLOOR);
};

export const getColumnSizeConfig = (
  column: ColumnDefinition<any>,
  layout: ColumnLayoutContext = DEFAULT_COLUMN_LAYOUT
): { size: number; minSize: number; maxSize: number } => {
  const columnId = getColumnId(column);
  const isPercentWidth = getPercentWidth(column.width) !== undefined;
  const parsedWidth = parseColumnWidth(column.width, layout);
  const titleLength = typeof column.title === 'string' ? column.title.length : 12;
  const declaredMin = parseMinWidth(column.minWidth, layout);

  if (COMPACT_COLUMN_IDS.has(columnId)) {
    // A selection column only ever holds a checkbox — keep it at checkbox width regardless
    // of any declared percentage.
    if (SELECTION_COLUMN_IDS.has(columnId)) {
      const floor = declaredMin ?? 44;
      const size = clampSize(parsedWidth ?? 48, floor, Math.max(56, floor));
      return { size, minSize: Math.min(floor, size), maxSize: Math.max(56, floor) };
    }
    const floor = declaredMin ?? 56;
    const size = clampSize(parsedWidth ?? 64, floor, Math.max(180, floor));
    return { size, minSize: Math.min(floor, size), maxSize: Math.max(180, floor) };
  }

  // A percent width expresses a proportion, not a hard size: never let it squeeze a column
  // below the natural width it would get with no width at all. When the natural widths don't
  // fit, columns hide behind the "show all" banner (with horizontal scroll) instead of every
  // column becoming unreadably narrow.
  if (columnId === 'title') {
    const naturalSize = 320;
    const preferred = parsedWidth !== undefined
      ? (isPercentWidth ? Math.max(parsedWidth, naturalSize) : parsedWidth)
      : naturalSize;
    const floor = declaredMin ?? 180;
    const size = clampSize(preferred, floor, 720);
    return { size, minSize: Math.min(floor, size), maxSize: 720 };
  }

  const naturalSize = Math.max(DEFAULT_COLUMN_SIZE, Math.min(280, titleLength * 12 + 72));
  const preferred = parsedWidth !== undefined
    ? (isPercentWidth ? Math.max(parsedWidth, naturalSize) : parsedWidth)
    : naturalSize;
  // A declared minWidth replaces the 96px floor for this column.
  const floor = declaredMin ?? 96;
  const size = clampSize(preferred, floor, 520);
  return { size, minSize: Math.min(floor, size), maxSize: 520 };
};

export interface ColumnFitResult {
  /** Ids of the columns that fit the container, in the original column order. */
  visibleColumnIds: string[];
  /** The last admitted column may be shrunk into the remaining space instead of hidden. */
  sizeOverrides: Record<string, number>;
}

// Decides which columns fit a container of the given width. Columns are accumulated in
// priority order using their real sizes (not a uniform estimate) so the visible set never
// exceeds the container width and the table doesn't scroll horizontally.
//
// Columns that declare `minWidth` are shrinkable: admission counts them at their minimum size
// (fixed columns at their preferred size), so they give up space before any column is hidden.
// Once the admitted set is known, any overflow of the preferred total is spread across the
// admitted shrinkable columns in proportion to their slack (size - minSize), floored, with the
// rounding remainder taken from the last shrinkable column(s) and never below minSize. The
// visible total then equals the container width. Without any `minWidth` there are no
// shrinkable columns and the result is exactly the plain greedy fit.
export const computeColumnFit = (
  columns: ColumnDefinition<any>[],
  containerWidth: number,
  layout: ColumnLayoutContext
): ColumnFitResult => {
  const allColumnIds = columns.map(col => getColumnId(col));

  // Check if the last column is an actions column with interactive elements. Detect by column
  // id, with the title check kept as a fallback (titles are localized, ids are not).
  const lastColumn = columns[columns.length - 1];
  const lastColumnId = lastColumn ? getColumnId(lastColumn) : '';
  const isActionsColumn = !!lastColumn && (
    lastColumnId === 'actions' || lastColumnId === 'action' ||
    ((lastColumn.title === 'Actions' || lastColumn.title === 'Action') && lastColumn.render !== undefined)
  );

  const prioritizedColumns = [...columns].sort((a, b) => {
    // Always prioritize Actions column if it's the last column
    if (isActionsColumn) {
      if (a === lastColumn) return -1;
      if (b === lastColumn) return 1;
    }

    // Keep ID column and any columns with explicit width as highest priority
    const aIsId = Array.isArray(a.dataIndex) ? a.dataIndex.includes('id') : a.dataIndex === 'id';
    const bIsId = Array.isArray(b.dataIndex) ? b.dataIndex.includes('id') : b.dataIndex === 'id';

    if (aIsId && !bIsId) return -1;
    if (!aIsId && bIsId) return 1;

    // Then prioritize columns with explicit width
    if (a.width && !b.width) return -1;
    if (!a.width && b.width) return 1;

    return 0;
  });

  // LEVERAGE: friction datatable-fit-no-flex-columns — the fit has no notion of a flexible
  // column; shrinking is opt-in per column via `minWidth` rather than the table sharing space.
  // Greedily include columns (highest priority first) until the next one would overflow.
  // Shrinkable columns (declared minWidth, minSize < size) are counted at minSize.
  const visible = new Set<string>();
  const sizeOverrides: Record<string, number> = {};
  const admitted: { id: string; size: number; minSize: number; shrinkable: boolean }[] = [];
  let usedWidth = 0;
  for (const col of prioritizedColumns) {
    const colId = getColumnId(col);
    const { size, minSize } = getColumnSizeConfig(col, layout);
    const shrinkable = !!col.minWidth && minSize < size;
    const countedSize = shrinkable ? minSize : size;
    if (visible.size > 0 && usedWidth + countedSize > containerWidth) {
      // The column doesn't fit at its preferred size, but if it can shrink into the
      // remaining space without going below its minimum, show it there instead of hiding it.
      const remaining = containerWidth - usedWidth;
      if (remaining >= minSize) {
        sizeOverrides[colId] = remaining;
        visible.add(colId);
        admitted.push({ id: colId, size: remaining, minSize, shrinkable: false });
      }
      break;
    }
    usedWidth += countedSize;
    visible.add(colId);
    admitted.push({ id: colId, size, minSize, shrinkable });
  }

  // Spread the overflow of the preferred total across the shrinkable columns by slack.
  const shrinkables = admitted.filter(c => c.shrinkable);
  if (shrinkables.length > 0) {
    const preferredTotal = admitted.reduce((sum, c) => sum + c.size, 0);
    const deficit = preferredTotal - containerWidth;
    if (deficit > 0) {
      const totalSlack = shrinkables.reduce((sum, c) => sum + (c.size - c.minSize), 0);
      const cuts = shrinkables.map(c => Math.min(
        c.size - c.minSize,
        Math.floor((deficit * (c.size - c.minSize)) / totalSlack)
      ));
      // Rounding remainder goes to the last shrinkable column (spilling backwards only if
      // that column would drop below its minSize).
      let remainder = deficit - cuts.reduce((sum, cut) => sum + cut, 0);
      for (let i = shrinkables.length - 1; i >= 0 && remainder > 0; i--) {
        const extra = Math.min(remainder, shrinkables[i].size - shrinkables[i].minSize - cuts[i]);
        cuts[i] += extra;
        remainder -= extra;
      }
      shrinkables.forEach((c, i) => {
        if (cuts[i] > 0) sizeOverrides[c.id] = c.size - cuts[i];
      });
    }
  }

  return {
    visibleColumnIds: allColumnIds.filter(colId => visible.has(colId)),
    sizeOverrides,
  };
};
